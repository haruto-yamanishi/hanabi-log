import type postgres from "postgres";
import { canReadReport } from "@/lib/authorization";
import { generateSummary } from "@/lib/text";
import type { DeliveryTarget } from "@/lib/constants";
import type {
  CurrentUser,
  IntegrationBinding,
  Member,
  OutboxJob,
  Report,
  ReportFilters,
  ReportInput,
  ReportPage,
} from "@/lib/types";
import { getDatabase } from "@/server/db/client";
import {
  mapAttachment,
  mapIntegrationBinding,
  mapMember,
  mapOutboxJob,
  mapRelatedLink,
  mapReport,
  type AttachmentRow,
  type IntegrationBindingRow,
  type MemberRow,
  type OutboxJobRow,
  type RelatedLinkRow,
  type ReportRow,
} from "@/server/db/mappers";
import { AppError } from "@/server/errors";
import {
  decodeReportCursor,
  encodeReportCursor,
  makeDedupeKey,
} from "@/server/repositories/outbox";
import type {
  ClaimJobsOptions,
  EnqueueIntegrationRetryInput,
  MemberUpsertInput,
  ReportRepository,
  RetryJobInput,
  SaveNotionBindingInput,
  SaveSlackBindingInput,
} from "@/server/repositories/types";

type Transaction = postgres.TransactionSql<Record<string, never>>;

interface LockedReportRow {
  id: string;
  author_id: string;
  status: Report["status"];
  version: number;
}

interface IdempotencyRow {
  response_body: { reportId?: unknown };
}

function reportColumns(sql: ReturnType<typeof getDatabase>) {
  return sql`
    r.id, r.author_id, r.report_date, r.title, r.summary,
    r.activity_area, r.content_category, r.activity_text, r.learning_text,
    r.issue_text, r.next_action_text, r.theme_tags, r.status, r.version,
    r.published_at, r.archived_at, r.created_at, r.updated_at,
    m.display_name as author_display_name,
    m.avatar_url as author_avatar_url
  `;
}

function reportIdFromIdempotency(row: IdempotencyRow | undefined): string | null {
  const id = row?.response_body?.reportId;
  return typeof id === "string" ? id : null;
}

async function replaceChildren(
  tx: Transaction,
  reportId: string,
  input: ReportInput,
): Promise<void> {
  const existingAttachments = await tx<
    { id: string; storage_path: string; notion_file_upload_id: string | null }[]
  >`
    select id::text as id, storage_path, notion_file_upload_id
    from attachments
    where report_id = ${reportId}
  `;
  const notionUploadIds = new Map<string, string>();
  for (const attachment of existingAttachments) {
    if (!attachment.notion_file_upload_id) continue;
    notionUploadIds.set(attachment.id, attachment.notion_file_upload_id);
    notionUploadIds.set(attachment.storage_path, attachment.notion_file_upload_id);
  }
  await tx`delete from related_links where report_id = ${reportId}`;
  await tx`delete from attachments where report_id = ${reportId}`;
  for (const [index, link] of (input.relatedLinks ?? []).entries()) {
    await tx`
      insert into related_links (id, report_id, label, url, sort_order)
      values (${link.id ?? crypto.randomUUID()}, ${reportId}, ${link.label}, ${link.url}, ${link.sortOrder ?? index})
    `;
  }
  for (const [index, attachment] of (input.attachments ?? []).entries()) {
    const attachmentId = attachment.id ?? crypto.randomUUID();
    const notionFileUploadId =
      notionUploadIds.get(attachmentId) ??
      notionUploadIds.get(attachment.storagePath) ??
      null;
    await tx`
      insert into attachments (
        id, report_id, storage_path, filename, mime_type, size_bytes, alt_text,
        sort_order, notion_file_upload_id
      ) values (
        ${attachmentId}, ${reportId}, ${attachment.storagePath},
        ${attachment.filename}, ${attachment.mimeType}, ${attachment.sizeBytes},
        ${attachment.altText ?? null}, ${attachment.sortOrder ?? index},
        ${notionFileUploadId}
      )
    `;
  }
}

async function enqueueJobs(
  tx: Transaction,
  reportId: string,
  reportVersion: number,
  action: OutboxJob["action"],
): Promise<void> {
  for (const target of ["slack", "notion"] as const) {
    await tx`
      insert into outbox_jobs (
        report_id, target, action, report_version, dedupe_key, status, available_at
      ) values (
        ${reportId}, ${target}, ${action}, ${reportVersion},
        ${makeDedupeKey(reportId, target, action, reportVersion)}, 'pending', now()
      )
      on conflict (dedupe_key) do nothing
    `;
  }
  await tx`
    insert into integration_bindings (
      report_id, notion_status, slack_status, updated_at
    ) values (${reportId}, 'pending', 'pending', now())
    on conflict (report_id) do update set
      notion_status = 'pending',
      notion_last_error = null,
      slack_status = 'pending',
      slack_last_error = null,
      updated_at = now()
  `;
}

function assertEditable(row: LockedReportRow, actor: CurrentUser): void {
  if (row.author_id !== actor.id && actor.role !== "admin") {
    throw new AppError("FORBIDDEN", "この日報を変更する権限がありません", 403);
  }
}

async function idempotencyLookup(
  tx: Transaction,
  actorId: string,
  operation: string,
  key: string,
): Promise<string | null> {
  await tx`select pg_advisory_xact_lock(hashtext(${`${actorId}:${operation}:${key}`}))`;
  const rows = await tx<IdempotencyRow[]>`
    select response_body
    from idempotency_keys
    where member_id = ${actorId} and operation = ${operation} and key = ${key}
  `;
  return reportIdFromIdempotency(rows[0]);
}

async function storeIdempotency(
  tx: Transaction,
  actorId: string,
  operation: string,
  key: string,
  reportId: string,
): Promise<void> {
  await tx`
    insert into idempotency_keys (member_id, operation, key, response_status, response_body)
    values (${actorId}, ${operation}, ${key}, 200, ${tx.json({ reportId })})
    on conflict (member_id, operation, key) do nothing
  `;
}

export class PostgresReportRepository implements ReportRepository {
  private readonly sql = getDatabase();

  private async hydrate(rows: ReportRow[]): Promise<Report[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [linkRows, attachmentRows, bindingRows] = await Promise.all([
      this.sql<RelatedLinkRow[]>`
        select id, report_id, label, url, sort_order
        from related_links
        where report_id in ${this.sql(ids)}
        order by sort_order, id
      `,
      this.sql<AttachmentRow[]>`
        select id, report_id, storage_path, filename, mime_type, size_bytes, alt_text, sort_order
        from attachments
        where report_id in ${this.sql(ids)}
        order by sort_order, id
      `,
      this.sql<IntegrationBindingRow[]>`
        select report_id, notion_page_id, notion_page_url, notion_status, notion_last_error,
               slack_channel_id, slack_message_ts, slack_permalink, slack_status,
               slack_last_error, updated_at
        from integration_bindings
        where report_id in ${this.sql(ids)}
      `,
    ]);
    const links = new Map<string, ReturnType<typeof mapRelatedLink>[]>();
    for (const row of linkRows) {
      const list = links.get(row.report_id) ?? [];
      list.push(mapRelatedLink(row));
      links.set(row.report_id, list);
    }
    const attachments = new Map<string, ReturnType<typeof mapAttachment>[]>();
    for (const row of attachmentRows) {
      const list = attachments.get(row.report_id) ?? [];
      list.push(mapAttachment(row));
      attachments.set(row.report_id, list);
    }
    const bindings = new Map(
      bindingRows.map((row) => [row.report_id, mapIntegrationBinding(row)]),
    );
    return rows.map((row) =>
      mapReport(
        row,
        links.get(row.id) ?? [],
        attachments.get(row.id) ?? [],
        bindings.get(row.id) ?? null,
      ),
    );
  }

  async upsertMember(input: MemberUpsertInput): Promise<Member> {
    const rows = await this.sql<MemberRow[]>`
      insert into members (
        slack_team_id, slack_user_id, display_name, email, avatar_url, role, updated_at
      ) values (
        ${input.slackTeamId}, ${input.slackUserId}, ${input.displayName},
        ${input.email ?? null}, ${input.avatarUrl ?? null}, ${input.role}, now()
      )
      on conflict (slack_team_id, slack_user_id) do update set
        display_name = excluded.display_name,
        email = excluded.email,
        avatar_url = excluded.avatar_url,
        updated_at = now()
      returning *
    `;
    return mapMember(rows[0]);
  }

  async getMember(memberId: string): Promise<Member | null> {
    const rows = await this.sql<MemberRow[]>`select * from members where id = ${memberId}`;
    return rows[0] ? mapMember(rows[0]) : null;
  }

  async listMembers(): Promise<Member[]> {
    const rows = await this.sql<MemberRow[]>`
      select *
      from members
      order by display_name asc, id asc
    `;
    return rows.map(mapMember);
  }

  async setMemberRole(memberId: string, role: Member["role"]): Promise<Member | null> {
    const rows = await this.sql<MemberRow[]>`
      update members
      set role = ${role}, updated_at = now()
      where id = ${memberId}
      returning *
    `;
    return rows[0] ? mapMember(rows[0]) : null;
  }

  async listReports(filters: ReportFilters, actor: CurrentUser): Promise<ReportPage> {
    const cursor = filters.cursor ? decodeReportCursor(filters.cursor) : null;
    if (filters.cursor && !cursor) {
      throw new AppError("INVALID_CURSOR", "ページ情報が正しくありません", 422);
    }
    const conditions = [
      actor.role === "admin"
        ? this.sql`true`
        : this.sql`(r.status = 'published' or r.author_id = ${actor.id})`,
    ];
    if (filters.q) {
      conditions.push(this.sql`
        (coalesce(r.title, '') || ' ' || coalesce(r.summary, '') || ' ' ||
         coalesce(r.activity_text, '') || ' ' || coalesce(r.learning_text, '') || ' ' ||
         coalesce(r.issue_text, '') || ' ' || coalesce(r.next_action_text, ''))
         ilike ${`%${filters.q}%`}
      `);
    }
    if (filters.activityArea) conditions.push(this.sql`r.activity_area = ${filters.activityArea}`);
    if (filters.contentCategory) {
      conditions.push(this.sql`r.content_category = ${filters.contentCategory}`);
    }
    if (filters.themeTag) conditions.push(this.sql`${filters.themeTag} = any(r.theme_tags)`);
    if (filters.authorId) conditions.push(this.sql`r.author_id = ${filters.authorId}`);
    if (filters.dateFrom) conditions.push(this.sql`r.report_date >= ${filters.dateFrom}`);
    if (filters.dateTo) conditions.push(this.sql`r.report_date <= ${filters.dateTo}`);
    if (filters.status) conditions.push(this.sql`r.status = ${filters.status}`);
    if (cursor) {
      conditions.push(this.sql`
        (r.report_date < ${cursor.reportDate} or
         (r.report_date = ${cursor.reportDate} and r.id < ${cursor.id}))
      `);
    }
    const where = conditions.slice(1).reduce(
      (combined, condition) => this.sql`${combined} and ${condition}`,
      conditions[0],
    );
    const limit = filters.limit ?? 20;
    const rows = await this.sql<ReportRow[]>`
      select ${reportColumns(this.sql)}
      from reports r
      join members m on m.id = r.author_id
      where ${where}
      order by r.report_date desc, r.id desc
      limit ${limit + 1}
    `;
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const reports = await this.hydrate(pageRows);
    const last = reports.at(-1);
    return {
      reports,
      nextCursor: hasMore && last ? encodeReportCursor(last.reportDate, last.id) : null,
    };
  }

  async getReport(reportId: string): Promise<Report | null> {
    const rows = await this.sql<ReportRow[]>`
      select ${reportColumns(this.sql)}
      from reports r
      join members m on m.id = r.author_id
      where r.id = ${reportId}
    `;
    return (await this.hydrate(rows))[0] ?? null;
  }

  async getReadableReport(reportId: string, actor: CurrentUser): Promise<Report | null> {
    const report = await this.getReport(reportId);
    return report && canReadReport(actor, report) ? report : null;
  }

  async createDraft(
    actor: CurrentUser,
    input: ReportInput,
    idempotencyKey?: string,
  ): Promise<Report> {
    const reportId = await this.sql.begin(async (rawTx) => {
      const tx = rawTx as Transaction;
      const operation = "create";
      if (idempotencyKey) {
        const existing = await idempotencyLookup(tx, actor.id, operation, idempotencyKey);
        if (existing) return existing;
      }
      const rows = await tx<{ id: string }[]>`
        insert into reports (
          author_id, report_date, title, summary, activity_area, content_category,
          activity_text, learning_text, issue_text, next_action_text, theme_tags, status
        ) values (
          ${actor.id}, ${input.reportDate}, ${input.title},
          ${input.summary || generateSummary(input.activityText)}, ${input.activityArea},
          ${input.contentCategory}, ${input.activityText}, ${input.learningText ?? ""},
          ${input.issueText ?? ""}, ${input.nextActionText ?? ""},
          ${tx.array(input.themeTags ?? [])}, 'draft'
        )
        returning id
      `;
      const id = rows[0].id;
      await replaceChildren(tx, id, input);
      if (idempotencyKey) await storeIdempotency(tx, actor.id, operation, idempotencyKey, id);
      return id;
    });
    return (await this.getReport(reportId))!;
  }

  async patchReport(
    reportId: string,
    actor: CurrentUser,
    expectedVersion: number,
    input: ReportInput,
  ): Promise<Report> {
    await this.sql.begin(async (rawTx) => {
      const tx = rawTx as Transaction;
      const rows = await tx<LockedReportRow[]>`
        select id, author_id, status, version from reports where id = ${reportId} for update
      `;
      const report = rows[0];
      if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
      assertEditable(report, actor);
      if (report.status === "archived") {
        throw new AppError("INVALID_STATE", "アーカイブ済みの日報は編集できません", 409);
      }
      if (report.version !== expectedVersion) {
        throw new AppError("VERSION_CONFLICT", "他の更新が反映されています。再読み込みしてください", 409);
      }
      const updated = await tx<{ version: number }[]>`
        update reports set
          report_date = ${input.reportDate}, title = ${input.title},
          summary = ${input.summary || generateSummary(input.activityText)},
          activity_area = ${input.activityArea}, content_category = ${input.contentCategory},
          activity_text = ${input.activityText}, learning_text = ${input.learningText ?? ""},
          issue_text = ${input.issueText ?? ""}, next_action_text = ${input.nextActionText ?? ""},
          theme_tags = ${tx.array(input.themeTags ?? [])},
          version = version + 1, updated_at = now()
        where id = ${reportId}
        returning version
      `;
      await replaceChildren(tx, reportId, input);
      if (report.status === "published") {
        await enqueueJobs(tx, reportId, updated[0].version, "update");
      }
    });
    return (await this.getReport(reportId))!;
  }

  async publishReport(
    reportId: string,
    actor: CurrentUser,
    idempotencyKey?: string,
  ): Promise<Report> {
    await this.sql.begin(async (rawTx) => {
      const tx = rawTx as Transaction;
      const operation = `publish:${reportId}`;
      if (idempotencyKey) {
        const existing = await idempotencyLookup(tx, actor.id, operation, idempotencyKey);
        if (existing) return;
      }
      const rows = await tx<LockedReportRow[]>`
        select id, author_id, status, version from reports where id = ${reportId} for update
      `;
      const report = rows[0];
      if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
      assertEditable(report, actor);
      if (report.status === "archived") {
        throw new AppError("INVALID_STATE", "アーカイブ済みの日報は公開できません", 409);
      }
      if (report.status === "draft") {
        const updated = await tx<{ version: number }[]>`
          update reports set status = 'published', published_at = now(),
            version = version + 1, updated_at = now()
          where id = ${reportId}
          returning version
        `;
        await enqueueJobs(tx, reportId, updated[0].version, "publish");
      }
      if (idempotencyKey) {
        await storeIdempotency(tx, actor.id, operation, idempotencyKey, reportId);
      }
    });
    return (await this.getReport(reportId))!;
  }

  async archiveReport(reportId: string, actor: CurrentUser): Promise<Report> {
    await this.sql.begin(async (rawTx) => {
      const tx = rawTx as Transaction;
      const rows = await tx<LockedReportRow[]>`
        select id, author_id, status, version from reports where id = ${reportId} for update
      `;
      const report = rows[0];
      if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
      assertEditable(report, actor);
      if (report.status !== "published") {
        throw new AppError("INVALID_STATE", "公開済みの日報だけをアーカイブできます", 409);
      }
      const updated = await tx<{ version: number }[]>`
        update reports set status = 'archived', archived_at = now(),
          version = version + 1, updated_at = now()
        where id = ${reportId}
        returning version
      `;
      await enqueueJobs(tx, reportId, updated[0].version, "archive");
    });
    return (await this.getReport(reportId))!;
  }

  async restoreReport(reportId: string, actor: CurrentUser): Promise<Report> {
    if (actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "管理者権限が必要です", 403);
    }
    await this.sql.begin(async (rawTx) => {
      const tx = rawTx as Transaction;
      const rows = await tx<LockedReportRow[]>`
        select id, author_id, status, version from reports where id = ${reportId} for update
      `;
      const report = rows[0];
      if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
      if (report.status !== "archived") {
        throw new AppError("INVALID_STATE", "アーカイブ済みの日報だけを復元できます", 409);
      }
      const updated = await tx<{ version: number }[]>`
        update reports set status = 'published', archived_at = null,
          version = version + 1, updated_at = now()
        where id = ${reportId}
        returning version
      `;
      await enqueueJobs(tx, reportId, updated[0].version, "restore");
    });
    return (await this.getReport(reportId))!;
  }

  async requestIntegrationRetry(
    reportId: string,
    target: DeliveryTarget,
    actor: CurrentUser,
  ): Promise<Report> {
    if (actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "管理者権限が必要です", 403);
    }
    await this.sql.begin(async (rawTx) => {
      const tx = rawTx as Transaction;
      const reports = await tx<LockedReportRow[]>`
        select id, author_id, status, version from reports where id = ${reportId} for update
      `;
      const report = reports[0];
      if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
      const existing = await tx<{ id: string; status: OutboxJob["status"] }[]>`
        select id, status from outbox_jobs
        where report_id = ${reportId} and target = ${target}
          and report_version = ${report.version}
        order by created_at desc
        limit 1
        for update
      `;
      if (existing[0] && existing[0].status !== "pending" && existing[0].status !== "processing") {
        await tx`
          update outbox_jobs set status = 'pending', attempts = 0, available_at = now(),
            locked_at = null, last_error = null, completed_at = null
          where id = ${existing[0].id}
        `;
      } else {
        const active = await tx<{ exists: boolean }[]>`
          select exists(
            select 1 from outbox_jobs
            where report_id = ${reportId} and target = ${target}
              and status in ('pending', 'processing')
          ) as exists
        `;
        if (!active[0]?.exists) {
          const action: OutboxJob["action"] = report.status === "archived" ? "archive" : "update";
          const key = makeDedupeKey(reportId, target, action, report.version);
          await tx`
            insert into outbox_jobs (
              report_id, target, action, report_version, dedupe_key, status, available_at
            ) values (${reportId}, ${target}, ${action}, ${report.version}, ${key}, 'pending', now())
            on conflict (dedupe_key) do update set
              status = 'pending', attempts = 0, available_at = now(), locked_at = null,
              last_error = null, completed_at = null
          `;
        }
      }
      await tx`
        insert into integration_bindings (report_id, notion_status, slack_status, updated_at)
        values (${reportId}, 'pending', 'pending', now())
        on conflict (report_id) do update set
          slack_status = case when ${target} = 'slack' then 'pending' else integration_bindings.slack_status end,
          slack_last_error = case when ${target} = 'slack' then null else integration_bindings.slack_last_error end,
          notion_status = case when ${target} = 'notion' then 'pending' else integration_bindings.notion_status end,
          notion_last_error = case when ${target} = 'notion' then null else integration_bindings.notion_last_error end,
          updated_at = now()
      `;
    });
    return (await this.getReport(reportId))!;
  }

  async claimJobs(options: ClaimJobsOptions): Promise<OutboxJob[]> {
    return this.sql.begin(async (rawTx) => {
      const tx = rawTx as Transaction;
      await tx`
        update outbox_jobs
        set status = 'failed', available_at = ${options.now}, locked_at = null,
            last_error = 'STALE_LOCK_RECOVERED'
        where status = 'processing'
          and locked_at < ${new Date(options.now.getTime() - 10 * 60_000)}
      `;
      const reportFilter = options.reportId
        ? tx`and r.id = ${options.reportId}`
        : tx``;
      // Lock parent report rows first. Jobs for one report must be claimed as a
      // group so two serverless invocations cannot update the same Slack
      // message or Notion page concurrently with different report versions.
      const lockedReports = await tx<{ id: string }[]>`
        select r.id
        from reports r
        where exists (
          select 1 from outbox_jobs available
          where available.report_id = r.id
            and available.status in ('pending', 'failed')
            and available.available_at <= ${options.now}
        )
          and not exists (
            select 1 from outbox_jobs active
            where active.report_id = r.id and active.status = 'processing'
          )
          ${reportFilter}
        order by (
          select min(available.available_at)
          from outbox_jobs available
          where available.report_id = r.id
            and available.status in ('pending', 'failed')
        ), r.id
        limit ${Math.max(0, Math.ceil(options.limit / 2))}
        for update of r skip locked
      `;
      if (!lockedReports.length) return [];
      const reportIds = lockedReports.map((row) => row.id);
      const rows = await tx<OutboxJobRow[]>`
        update outbox_jobs jobs
        set status = 'processing', locked_at = ${options.now}
        where jobs.report_id in ${tx(reportIds)}
          and jobs.status in ('pending', 'failed')
          and jobs.available_at <= ${options.now}
        returning jobs.*
      `;
      return rows.map(mapOutboxJob);
    });
  }

  async getBinding(reportId: string): Promise<IntegrationBinding | null> {
    const rows = await this.sql<IntegrationBindingRow[]>`
      select report_id, notion_page_id, notion_page_url, notion_status, notion_last_error,
             slack_channel_id, slack_message_ts, slack_permalink, slack_status,
             slack_last_error, updated_at
      from integration_bindings where report_id = ${reportId}
    `;
    return rows[0] ? mapIntegrationBinding(rows[0]) : null;
  }

  async saveSlackBinding(reportId: string, input: SaveSlackBindingInput): Promise<void> {
    await this.sql`
      insert into integration_bindings (
        report_id, notion_status, slack_status, slack_channel_id, slack_message_ts,
        slack_permalink, slack_last_error, updated_at
      ) values (
        ${reportId}, 'pending', ${input.status}, ${input.channelId ?? null},
        ${input.messageTs ?? null}, ${input.permalink ?? null}, ${input.errorCode ?? null}, now()
      )
      on conflict (report_id) do update set
        slack_channel_id = case when ${input.channelId !== undefined} then ${input.channelId ?? null} else integration_bindings.slack_channel_id end,
        slack_message_ts = case when ${input.messageTs !== undefined} then ${input.messageTs ?? null} else integration_bindings.slack_message_ts end,
        slack_permalink = case when ${input.permalink !== undefined} then ${input.permalink ?? null} else integration_bindings.slack_permalink end,
        slack_status = ${input.status}, slack_last_error = ${input.errorCode ?? null}, updated_at = now()
    `;
  }

  async saveNotionBinding(reportId: string, input: SaveNotionBindingInput): Promise<void> {
    await this.sql`
      insert into integration_bindings (
        report_id, notion_status, slack_status, notion_page_id, notion_page_url,
        notion_last_error, updated_at
      ) values (
        ${reportId}, ${input.status}, 'pending', ${input.pageId ?? null},
        ${input.pageUrl ?? null}, ${input.errorCode ?? null}, now()
      )
      on conflict (report_id) do update set
        notion_page_id = case when ${input.pageId !== undefined} then ${input.pageId ?? null} else integration_bindings.notion_page_id end,
        notion_page_url = case when ${input.pageUrl !== undefined} then ${input.pageUrl ?? null} else integration_bindings.notion_page_url end,
        notion_status = ${input.status}, notion_last_error = ${input.errorCode ?? null}, updated_at = now()
    `;
  }

  async completeJob(jobId: string, input: { completedAt: Date }): Promise<void> {
    await this.sql`
      update outbox_jobs set status = 'delivered', completed_at = ${input.completedAt},
        locked_at = null, last_error = null
      where id = ${jobId}
    `;
  }

  async retryJob(jobId: string, input: RetryJobInput): Promise<void> {
    await this.sql`
      update outbox_jobs set attempts = ${input.attempts}, status = ${input.status},
        available_at = ${input.availableAt}, last_error = ${input.errorCode}, locked_at = null
      where id = ${jobId}
    `;
  }

  async enqueueIntegrationRetry(input: EnqueueIntegrationRetryInput): Promise<void> {
    const key = makeDedupeKey(
      input.reportId,
      input.target,
      input.action,
      input.reportVersion,
    );
    await this.sql`
      insert into outbox_jobs (
        report_id, target, action, report_version, dedupe_key, status, attempts,
        available_at, last_error
      ) values (
        ${input.reportId}, ${input.target}, ${input.action}, ${input.reportVersion},
        ${key}, 'failed', ${input.attempts}, ${input.availableAt}, ${input.errorCode}
      )
      on conflict (dedupe_key) do update set
        status = 'failed', attempts = excluded.attempts,
        available_at = excluded.available_at, locked_at = null,
        last_error = excluded.last_error, completed_at = null
    `;
  }

  async completeSupersededJob(jobId: string, input: { completedAt: Date }): Promise<void> {
    await this.completeJob(jobId, input);
  }
}
