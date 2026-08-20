import { generateSummary } from "@/lib/text";
import type { DeliveryTarget } from "@/lib/constants";
import type {
  Attachment,
  CurrentUser,
  IntegrationBinding,
  Member,
  OutboxJob,
  RelatedLink,
  Report,
  ReportFilters,
  ReportInput,
  ReportLikeSummary,
  ReportPage,
} from "@/lib/types";
import { canEditReport, canReadReport } from "@/lib/authorization";
import { env } from "@/server/env";
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
  WeeklyBestInput,
  WeeklyDigestDeliveryInput,
} from "@/server/repositories/types";

interface MemoryState {
  members: Map<string, Member>;
  reports: Map<string, Report>;
  likes: Map<string, Set<string>>;
  weeklyDigests: Map<string, { status: "processing" | "delivered" | "failed"; updatedAt: string }>;
  jobs: Map<string, OutboxJob>;
  idempotency: Map<string, string>;
}

const DEMO_MEMBER_ID = "00000000-0000-4000-8000-000000000001";

function nowIso(): string {
  return new Date().toISOString();
}

function initialState(): MemoryState {
  const now = nowIso();
  const demoMember: Member = {
    id: DEMO_MEMBER_ID,
    slackTeamId: env.SLACK_TEAM_ID ?? "T_DEMO",
    slackUserId: "U_DEMO",
    displayName: "HANABI Demo",
    email: null,
    avatarUrl: null,
    role: "admin",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  const samples: Report[] = [
    {
      id: "00000000-0000-4000-8000-000000000101",
      authorId: demoMember.id,
      author: clone(demoMember),
      reportDate: "2026-08-18",
      title: "ドライブベースの配線方針を整理",
      summary: "保守しやすい配線経路とラベルの付け方をチームで揃えた。",
      activityArea: "ロボット",
      contentCategory: "判断・意思決定",
      activityText: "電源系と信号系の経路を分け、交換頻度の高い部品へすぐアクセスできる配置を確認した。",
      learningText: "写真だけでなく、配線ラベルの命名規則も残すと再組立てが速くなる。",
      issueText: "予備コネクタの在庫数を確認する必要がある。",
      nextActionText: "配線図へラベル番号を反映する。",
      themeTags: ["電装", "製作"],
      status: "published",
      version: 2,
      publishedAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      relatedLinks: [],
      attachments: [],
      integration: {
        reportId: "00000000-0000-4000-8000-000000000101",
        notionStatus: "delivered",
        slackStatus: "delivered",
        updatedAt: now,
      },
    },
    {
      id: "00000000-0000-4000-8000-000000000102",
      authorId: demoMember.id,
      author: clone(demoMember),
      reportDate: "2026-08-17",
      title: "新メンバー向けCAD練習会",
      summary: "基本操作から部品の拘束までを短い課題で確認した。",
      activityArea: "事務局",
      contentCategory: "会議・共有",
      activityText: "新メンバー向けにスケッチ、押し出し、アセンブリ拘束の順で練習会を行った。",
      learningText: "完成例を先に見せると、各操作の目的を理解しやすい。",
      issueText: "端末ごとの設定差をなくす手順書が必要。",
      nextActionText: "次回は実際のブラケットを題材にする。",
      themeTags: ["CAD・設計", "教育", "採用・育成"],
      status: "published",
      version: 2,
      publishedAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      relatedLinks: [],
      attachments: [],
      integration: {
        reportId: "00000000-0000-4000-8000-000000000102",
        notionStatus: "delivered",
        slackStatus: "delivered",
        updatedAt: now,
      },
    },
    {
      id: "00000000-0000-4000-8000-000000000103",
      authorId: demoMember.id,
      author: clone(demoMember),
      reportDate: "2026-08-16",
      title: "スポンサー説明資料の構成見直し",
      summary: "活動成果が短時間で伝わるよう、冒頭の構成と数値の見せ方を更新した。",
      activityArea: "ファンドレイジング",
      contentCategory: "成果",
      activityText: "説明資料を活動目的、今季の成果、支援の使途、次の目標の順に並べ直した。",
      learningText: "専門用語より、地域や生徒への効果を具体的な数字で示す方が伝わりやすい。",
      issueText: "掲載できる写真の利用許諾を確認中。",
      nextActionText: "班ごとの成果数値を集約して最終版へ反映する。",
      themeTags: ["スポンサー", "広報・SNS"],
      status: "published",
      version: 2,
      publishedAt: now,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      relatedLinks: [],
      attachments: [],
      integration: {
        reportId: "00000000-0000-4000-8000-000000000103",
        notionStatus: "delivered",
        slackStatus: "delivered",
        updatedAt: now,
      },
    },
  ];
  return {
    members: new Map([[demoMember.id, demoMember]]),
    reports: new Map(samples.map((report) => [report.id, report])),
    likes: new Map(),
    weeklyDigests: new Map(),
    jobs: new Map(),
    idempotency: new Map(),
  };
}

const globalMemory = globalThis as typeof globalThis & {
  __hanabiMemoryState?: MemoryState;
};

function state(): MemoryState {
  globalMemory.__hanabiMemoryState ??= initialState();
  return globalMemory.__hanabiMemoryState;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function reportWithLikes(report: Report, actorId?: string): Report {
  const likes = state().likes.get(report.id) ?? new Set<string>();
  const likedBy = [...likes]
    .map((memberId) => state().members.get(memberId))
    .filter((member): member is Member => Boolean(member))
    .map((member) => ({
      id: member.id,
      displayName: member.displayName,
      avatarUrl: member.avatarUrl,
    }));
  return {
    ...clone(report),
    likeCount: likes.size,
    likedByCurrentUser: actorId ? likes.has(actorId) : false,
    likedBy,
  };
}

function weeklyDigestKey(input: WeeklyDigestDeliveryInput): string {
  return `${input.periodStart}:${input.channelId}`;
}

function buildLinks(input: ReportInput): RelatedLink[] {
  return (input.relatedLinks ?? []).map((link, index) => ({
    ...link,
    id: link.id ?? crypto.randomUUID(),
    sortOrder: link.sortOrder ?? index,
  }));
}

function buildAttachments(input: ReportInput): Attachment[] {
  return (input.attachments ?? []).map((attachment, index) => ({
    ...attachment,
    id: attachment.id ?? crypto.randomUUID(),
    altText: attachment.altText ?? null,
    sortOrder: attachment.sortOrder ?? index,
  }));
}

function ensureEditable(report: Report, actor: CurrentUser): void {
  if (!canEditReport(actor, report)) {
    throw new AppError("FORBIDDEN", "この日報を変更する権限がありません", 403);
  }
}

function defaultBinding(reportId: string): IntegrationBinding {
  return {
    reportId,
    notionStatus: "pending",
    slackStatus: "pending",
    updatedAt: nowIso(),
  };
}

function putJobs(report: Report, action: OutboxJob["action"]): void {
  for (const target of ["slack", "notion"] as const) {
    const dedupeKey = makeDedupeKey(report.id, target, action, report.version);
    if ([...state().jobs.values()].some((job) => job.dedupeKey === dedupeKey)) continue;
    const now = nowIso();
    const job: OutboxJob = {
      id: crypto.randomUUID(),
      reportId: report.id,
      target,
      action,
      reportVersion: report.version,
      dedupeKey,
      status: "pending",
      attempts: 0,
      availableAt: now,
      createdAt: now,
    };
    state().jobs.set(job.id, job);
  }
  report.integration ??= defaultBinding(report.id);
  report.integration.slackStatus = "pending";
  report.integration.notionStatus = "pending";
  report.integration.updatedAt = nowIso();
}

function idempotencyId(actor: CurrentUser, operation: string, key: string): string {
  return `${actor.id}:${operation}:${key}`;
}

function updateReportFields(report: Report, input: ReportInput): void {
  report.reportDate = input.reportDate;
  report.title = input.title;
  report.summary = input.summary || generateSummary(input.activityText);
  report.activityArea = input.activityArea;
  report.contentCategory = input.contentCategory;
  report.activityText = input.activityText;
  report.learningText = input.learningText ?? "";
  report.issueText = input.issueText ?? "";
  report.nextActionText = input.nextActionText ?? "";
  report.themeTags = input.themeTags ?? [];
  report.relatedLinks = buildLinks(input);
  report.attachments = buildAttachments(input);
}

export function getDemoMember(): Member {
  return clone(state().members.get(DEMO_MEMBER_ID)!);
}

export class MemoryReportRepository implements ReportRepository {
  async upsertMember(input: MemberUpsertInput): Promise<Member> {
    const existing = [...state().members.values()].find(
      (member) =>
        member.slackTeamId === input.slackTeamId && member.slackUserId === input.slackUserId,
    );
    const now = nowIso();
    if (existing) {
      existing.displayName = input.displayName;
      existing.email = input.email ?? null;
      existing.avatarUrl = input.avatarUrl ?? null;
      existing.updatedAt = now;
      return clone(existing);
    }
    const member: Member = {
      id: crypto.randomUUID(),
      slackTeamId: input.slackTeamId,
      slackUserId: input.slackUserId,
      displayName: input.displayName,
      email: input.email ?? null,
      avatarUrl: input.avatarUrl ?? null,
      role: input.role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    state().members.set(member.id, member);
    return clone(member);
  }

  async getMember(memberId: string): Promise<Member | null> {
    const member = state().members.get(memberId);
    return member ? clone(member) : null;
  }

  async listMembers(): Promise<Member[]> {
    return clone(
      [...state().members.values()].sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName, "ja") || left.id.localeCompare(right.id),
      ),
    );
  }

  async setMemberRole(memberId: string, role: Member["role"]): Promise<Member | null> {
    const member = state().members.get(memberId);
    if (!member) return null;
    member.role = role;
    if (role === "admin") member.isActive = true;
    member.updatedAt = nowIso();
    return clone(member);
  }

  async setMemberActivity(memberId: string, isActive: boolean): Promise<Member | null> {
    const member = state().members.get(memberId);
    if (!member) return null;
    member.isActive = isActive;
    member.updatedAt = nowIso();
    return clone(member);
  }

  async deleteMember(memberId: string): Promise<"deleted" | "not_found" | "has_reports"> {
    if (!state().members.has(memberId)) return "not_found";
    if ([...state().reports.values()].some((report) => report.authorId === memberId)) {
      return "has_reports";
    }
    state().members.delete(memberId);
    for (const likes of state().likes.values()) likes.delete(memberId);
    return "deleted";
  }

  async listReports(filters: ReportFilters, actor: CurrentUser): Promise<ReportPage> {
    const cursor = filters.cursor ? decodeReportCursor(filters.cursor) : null;
    if (filters.cursor && !cursor) {
      throw new AppError("INVALID_CURSOR", "ページ情報が正しくありません", 422);
    }
    const query = filters.q?.toLocaleLowerCase("ja") ?? "";
    const reports = [...state().reports.values()]
      .filter((report) => canReadReport(actor, report))
      .filter((report) => !filters.activityArea || report.activityArea === filters.activityArea)
      .filter(
        (report) => !filters.contentCategory || report.contentCategory === filters.contentCategory,
      )
      .filter((report) => !filters.themeTag || report.themeTags.includes(filters.themeTag))
      .filter((report) => !filters.authorId || report.authorId === filters.authorId)
      .filter((report) => !filters.dateFrom || report.reportDate >= filters.dateFrom)
      .filter((report) => !filters.dateTo || report.reportDate <= filters.dateTo)
      .filter((report) => !filters.status || report.status === filters.status)
      .filter((report) => {
        if (!query) return true;
        return [
          report.title,
          report.summary,
          report.activityText,
          report.learningText,
          report.issueText,
          report.nextActionText,
        ]
          .join(" ")
          .toLocaleLowerCase("ja")
          .includes(query);
      })
      .sort((left, right) =>
        (right.publishedAt ?? right.updatedAt).localeCompare(left.publishedAt ?? left.updatedAt) ||
        right.id.localeCompare(left.id),
      )
      .filter(
        (report) =>
          !cursor ||
          (report.publishedAt ?? report.updatedAt) < cursor.sortAt ||
          ((report.publishedAt ?? report.updatedAt) === cursor.sortAt && report.id < cursor.id),
      );
    const limit = filters.limit ?? 20;
    const page = reports.slice(0, limit);
    const last = page.at(-1);
    return {
      reports: page.map((report) => reportWithLikes(report, actor.id)),
      nextCursor:
        reports.length > page.length && last
          ? encodeReportCursor(last.publishedAt ?? last.updatedAt, last.id)
          : null,
    };
  }

  async getReport(reportId: string): Promise<Report | null> {
    const report = state().reports.get(reportId);
    return report ? reportWithLikes(report) : null;
  }

  async getReadableReport(reportId: string, actor: CurrentUser): Promise<Report | null> {
    const report = state().reports.get(reportId);
    return report && canReadReport(actor, report) ? reportWithLikes(report, actor.id) : null;
  }

  async setReportLike(
    reportId: string,
    actor: CurrentUser,
    liked: boolean,
  ): Promise<ReportLikeSummary> {
    const report = state().reports.get(reportId);
    if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
    if (report.status !== "published") {
      throw new AppError("INVALID_STATE", "公開中の日報だけにいいねできます", 409);
    }
    const likes = state().likes.get(reportId) ?? new Set<string>();
    if (liked) likes.add(actor.id);
    else likes.delete(actor.id);
    state().likes.set(reportId, likes);
    return {
      likeCount: likes.size,
      liked,
      likedBy: reportWithLikes(report, actor.id).likedBy ?? [],
    };
  }

  async listWeeklyBestReports(input: WeeklyBestInput): Promise<Report[]> {
    return [...state().reports.values()]
      .filter(
        (report) =>
          report.status === "published" &&
          Boolean(report.publishedAt) &&
          report.publishedAt! >= input.periodStart.toISOString() &&
          report.publishedAt! < input.periodEnd.toISOString(),
      )
      .sort(
        (left, right) =>
          (state().likes.get(right.id)?.size ?? 0) - (state().likes.get(left.id)?.size ?? 0) ||
          (right.publishedAt ?? "").localeCompare(left.publishedAt ?? "") ||
          right.id.localeCompare(left.id),
      )
      .slice(0, input.limit)
      .map((report) => reportWithLikes(report));
  }

  async claimWeeklyDigest(
    input: WeeklyDigestDeliveryInput,
  ): Promise<"claimed" | "delivered" | "processing"> {
    const key = weeklyDigestKey(input);
    const existing = state().weeklyDigests.get(key);
    if (existing?.status === "delivered") return "delivered";
    if (
      existing?.status === "processing" &&
      Date.now() - new Date(existing.updatedAt).getTime() < 15 * 60_000
    ) {
      return "processing";
    }
    state().weeklyDigests.set(key, { status: "processing", updatedAt: nowIso() });
    return "claimed";
  }

  async completeWeeklyDigest(
    input: WeeklyDigestDeliveryInput & { messageTs: string },
  ): Promise<void> {
    state().weeklyDigests.set(weeklyDigestKey(input), {
      status: "delivered",
      updatedAt: nowIso(),
    });
  }

  async failWeeklyDigest(
    input: WeeklyDigestDeliveryInput & { errorCode: string },
  ): Promise<void> {
    state().weeklyDigests.set(weeklyDigestKey(input), {
      status: "failed",
      updatedAt: nowIso(),
    });
  }

  async createDraft(
    actor: CurrentUser,
    input: ReportInput,
    idempotencyKey?: string,
  ): Promise<Report> {
    if (idempotencyKey) {
      const existingId = state().idempotency.get(idempotencyId(actor, "create", idempotencyKey));
      if (existingId) return clone(state().reports.get(existingId)!);
    }
    const author = state().members.get(actor.id);
    if (!author) throw new AppError("UNAUTHORIZED", "ログインが必要です", 401);
    const now = nowIso();
    const report: Report = {
      id: crypto.randomUUID(),
      authorId: actor.id,
      author: clone(author),
      reportDate: input.reportDate,
      title: input.title,
      summary: input.summary || generateSummary(input.activityText),
      activityArea: input.activityArea,
      contentCategory: input.contentCategory,
      activityText: input.activityText,
      learningText: input.learningText ?? "",
      issueText: input.issueText ?? "",
      nextActionText: input.nextActionText ?? "",
      themeTags: input.themeTags ?? [],
      status: "draft",
      version: 1,
      publishedAt: null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      relatedLinks: buildLinks(input),
      attachments: buildAttachments(input),
      integration: null,
    };
    state().reports.set(report.id, report);
    if (idempotencyKey) {
      state().idempotency.set(idempotencyId(actor, "create", idempotencyKey), report.id);
    }
    return clone(report);
  }

  async patchReport(
    reportId: string,
    actor: CurrentUser,
    expectedVersion: number,
    input: ReportInput,
  ): Promise<Report> {
    const report = state().reports.get(reportId);
    if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
    ensureEditable(report, actor);
    if (report.status === "archived") {
      throw new AppError("INVALID_STATE", "アーカイブ済みの日報は編集できません", 409);
    }
    if (report.version !== expectedVersion) {
      throw new AppError("VERSION_CONFLICT", "他の更新が反映されています。再読み込みしてください", 409);
    }
    updateReportFields(report, input);
    report.version += 1;
    report.updatedAt = nowIso();
    if (report.status === "published") putJobs(report, "update");
    return clone(report);
  }

  async publishReport(
    reportId: string,
    actor: CurrentUser,
    idempotencyKey?: string,
  ): Promise<Report> {
    if (idempotencyKey) {
      const existingId = state().idempotency.get(
        idempotencyId(actor, `publish:${reportId}`, idempotencyKey),
      );
      if (existingId) return clone(state().reports.get(existingId)!);
    }
    const report = state().reports.get(reportId);
    if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
    ensureEditable(report, actor);
    if (report.status === "archived") {
      throw new AppError("INVALID_STATE", "アーカイブ済みの日報は公開できません", 409);
    }
    if (report.status === "draft") {
      const now = nowIso();
      const publishImmediately = actor.role === "admin" || actor.isActive;
      report.status = publishImmediately ? "published" : "pending_approval";
      report.publishedAt = publishImmediately ? now : null;
      report.version += 1;
      report.updatedAt = now;
      if (publishImmediately) putJobs(report, "publish");
    }
    if (idempotencyKey) {
      state().idempotency.set(
        idempotencyId(actor, `publish:${reportId}`, idempotencyKey),
        report.id,
      );
    }
    return clone(report);
  }

  async approveReport(reportId: string, actor: CurrentUser): Promise<Report> {
    if (actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "日報を承認できるのはAdminだけです", 403);
    }
    const report = state().reports.get(reportId);
    if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
    if (report.status !== "pending_approval") {
      throw new AppError("INVALID_STATE", "承認待ちの日報だけを承認できます", 409);
    }
    const now = nowIso();
    report.status = "published";
    report.publishedAt = now;
    report.version += 1;
    report.updatedAt = now;
    putJobs(report, "publish");
    return clone(report);
  }

  async archiveReport(reportId: string, actor: CurrentUser): Promise<Report> {
    const report = state().reports.get(reportId);
    if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
    ensureEditable(report, actor);
    if (report.status !== "published") {
      throw new AppError("INVALID_STATE", "公開済みの日報だけをアーカイブできます", 409);
    }
    const now = nowIso();
    report.status = "archived";
    report.archivedAt = now;
    report.version += 1;
    report.updatedAt = now;
    putJobs(report, "archive");
    return clone(report);
  }

  async restoreReport(reportId: string, actor: CurrentUser): Promise<Report> {
    if (actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "管理者権限が必要です", 403);
    }
    const report = state().reports.get(reportId);
    if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
    if (report.status !== "archived") {
      throw new AppError("INVALID_STATE", "アーカイブ済みの日報だけを復元できます", 409);
    }
    const now = nowIso();
    report.status = "published";
    report.archivedAt = null;
    report.version += 1;
    report.updatedAt = now;
    putJobs(report, "restore");
    return clone(report);
  }

  async deleteReport(reportId: string, actor: CurrentUser): Promise<void> {
    if (actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "管理者権限が必要です", 403);
    }
    if (!state().reports.has(reportId)) {
      throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
    }
    state().reports.delete(reportId);
    state().likes.delete(reportId);
    for (const [jobId, job] of state().jobs) {
      if (job.reportId === reportId) state().jobs.delete(jobId);
    }
    for (const [key, storedReportId] of state().idempotency) {
      if (storedReportId === reportId) state().idempotency.delete(key);
    }
  }

  async requestIntegrationRetry(
    reportId: string,
    target: DeliveryTarget,
    actor: CurrentUser,
  ): Promise<Report> {
    if (actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "管理者権限が必要です", 403);
    }
    const report = state().reports.get(reportId);
    if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
    const jobs = [...state().jobs.values()]
      .filter(
        (job) =>
          job.reportId === reportId &&
          job.target === target &&
          job.reportVersion === report.version,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const existing = jobs.find((job) => job.status !== "pending" && job.status !== "processing");
    if (existing) {
      existing.status = "pending";
      existing.attempts = 0;
      existing.availableAt = nowIso();
      existing.lockedAt = null;
      existing.lastError = null;
      existing.completedAt = null;
    } else if (!jobs.some((job) => job.status === "pending" || job.status === "processing")) {
      const action: OutboxJob["action"] = report.status === "archived" ? "archive" : "update";
      const now = nowIso();
      const job: OutboxJob = {
        id: crypto.randomUUID(),
        reportId,
        target,
        action,
        reportVersion: report.version,
        dedupeKey: makeDedupeKey(reportId, target, action, report.version),
        status: "pending",
        attempts: 0,
        availableAt: now,
        createdAt: now,
      };
      state().jobs.set(job.id, job);
    }
    report.integration ??= defaultBinding(report.id);
    if (target === "slack") {
      report.integration.slackStatus = "pending";
      report.integration.slackLastError = null;
    } else {
      report.integration.notionStatus = "pending";
      report.integration.notionLastError = null;
    }
    report.integration.updatedAt = nowIso();
    return clone(report);
  }

  async claimJobs(options: ClaimJobsOptions): Promise<OutboxJob[]> {
    if (options.limit <= 0) return [];
    const now = options.now.toISOString();
    const staleBefore = options.now.getTime() - 10 * 60_000;
    for (const job of state().jobs.values()) {
      if (
        job.status === "processing" &&
        job.lockedAt &&
        new Date(job.lockedAt).getTime() < staleBefore
      ) {
        job.status = "failed";
        job.availableAt = now;
        job.lockedAt = null;
        job.lastError = "STALE_LOCK_RECOVERED";
      }
    }
    const eligible = [...state().jobs.values()]
      .filter(
        (job) =>
          (!options.reportId || job.reportId === options.reportId) &&
          (job.status === "pending" || job.status === "failed") &&
          job.availableAt <= now &&
          ![...state().jobs.values()].some(
            (active) =>
              active.reportId === job.reportId && active.status === "processing",
          ),
      )
      .sort(
        (left, right) =>
          left.availableAt.localeCompare(right.availableAt) ||
          left.createdAt.localeCompare(right.createdAt),
      );
    const jobs: OutboxJob[] = [];
    const claimedReports = new Set<string>();
    for (const candidate of eligible) {
      if (claimedReports.has(candidate.reportId)) continue;
      const group = eligible.filter((job) => job.reportId === candidate.reportId);
      if (jobs.length > 0 && jobs.length + group.length > options.limit) break;
      jobs.push(...group);
      claimedReports.add(candidate.reportId);
      if (jobs.length >= options.limit) break;
    }
    for (const job of jobs) {
      job.status = "processing";
      job.lockedAt = now;
    }
    return clone(jobs);
  }

  async getBinding(reportId: string): Promise<IntegrationBinding | null> {
    return clone(state().reports.get(reportId)?.integration ?? null);
  }

  async saveSlackBinding(reportId: string, input: SaveSlackBindingInput): Promise<void> {
    const report = state().reports.get(reportId);
    if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
    report.integration ??= defaultBinding(reportId);
    if (input.channelId !== undefined) report.integration.slackChannelId = input.channelId;
    if (input.messageTs !== undefined) report.integration.slackMessageTs = input.messageTs;
    if (input.permalink !== undefined) report.integration.slackPermalink = input.permalink;
    report.integration.slackStatus = input.status;
    report.integration.slackLastError = input.errorCode ?? null;
    report.integration.updatedAt = nowIso();
  }

  async saveNotionBinding(reportId: string, input: SaveNotionBindingInput): Promise<void> {
    const report = state().reports.get(reportId);
    if (!report) throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
    report.integration ??= defaultBinding(reportId);
    if (input.pageId !== undefined) report.integration.notionPageId = input.pageId;
    if (input.pageUrl !== undefined) report.integration.notionPageUrl = input.pageUrl;
    report.integration.notionStatus = input.status;
    report.integration.notionLastError = input.errorCode ?? null;
    report.integration.updatedAt = nowIso();
  }

  async completeJob(jobId: string, input: { completedAt: Date }): Promise<void> {
    const job = state().jobs.get(jobId);
    if (!job) return;
    job.status = "delivered";
    job.completedAt = input.completedAt.toISOString();
    job.lockedAt = null;
    job.lastError = null;
  }

  async retryJob(jobId: string, input: RetryJobInput): Promise<void> {
    const job = state().jobs.get(jobId);
    if (!job) return;
    job.attempts = input.attempts;
    job.status = input.status;
    job.availableAt = input.availableAt.toISOString();
    job.lastError = input.errorCode;
    job.lockedAt = null;
  }

  async enqueueIntegrationRetry(input: EnqueueIntegrationRetryInput): Promise<void> {
    const dedupeKey = makeDedupeKey(
      input.reportId,
      input.target,
      input.action,
      input.reportVersion,
    );
    const existing = [...state().jobs.values()].find(
      (job) => job.dedupeKey === dedupeKey,
    );
    const job: OutboxJob = existing ?? {
      id: crypto.randomUUID(),
      reportId: input.reportId,
      target: input.target,
      action: input.action,
      reportVersion: input.reportVersion,
      dedupeKey,
      status: "failed",
      attempts: input.attempts,
      availableAt: input.availableAt.toISOString(),
      createdAt: nowIso(),
    };
    job.status = "failed";
    job.attempts = input.attempts;
    job.availableAt = input.availableAt.toISOString();
    job.lockedAt = null;
    job.lastError = input.errorCode;
    job.completedAt = null;
    state().jobs.set(job.id, job);
  }

  async completeSupersededJob(jobId: string, input: { completedAt: Date }): Promise<void> {
    await this.completeJob(jobId, input);
  }
}
