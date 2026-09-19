import "server-only";
import { WebClient } from "@slack/web-api";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";

const HANABI_LOG_BASE_URL = "https://log.9494hanabi.com";
const FEATURED_REPORT_PROBABILITY = 0.3;

interface InactiveMemberRow {
  id: string;
  slack_user_id: string;
  display_name: string;
  created_at: Date | string;
  last_contribution_at: Date | string | null;
}

interface RecommendationRow {
  id: string;
  author_id: string;
  title: string;
  summary: string | null;
  author_name: string;
  author_slack_user_id: string;
  published_at: Date | string;
}

export interface ContributionNudgeResult {
  checked: number;
  delivered: number;
  alreadyHandled: number;
  failed: number;
  skippedNoRecommendation: number;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function escapeSlack(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function configuredFeaturedSlackUserId(): string | null {
  if (env.CONTRIBUTION_NUDGE_FEATURED_SLACK_USER_ID) {
    return env.CONTRIBUTION_NUDGE_FEATURED_SLACK_USER_ID;
  }
  return (env.ADMIN_SLACK_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .find(Boolean) ?? null;
}

function episodeKey(member: InactiveMemberRow): string {
  return member.last_contribution_at
    ? `after:${toIso(member.last_contribution_at)}`
    : `never:${toIso(member.created_at)}`;
}

export function pickContributionNudgeRecommendation(
  reports: RecommendationRow[],
  input: {
    recipientMemberId: string;
    featuredSlackUserId: string | null;
    random?: () => number;
  },
): RecommendationRow | null {
  if (!reports.length) return null;
  const random = input.random ?? Math.random;
  const featuredPool = input.featuredSlackUserId
    ? reports.filter((report) => report.author_slack_user_id === input.featuredSlackUserId)
    : [];
  const regularPool = reports.filter(
    (report) =>
      report.author_id !== input.recipientMemberId &&
      report.author_slack_user_id !== input.featuredSlackUserId,
  );
  const otherPeoplePool = reports.filter((report) => report.author_id !== input.recipientMemberId);

  let pool: RecommendationRow[];
  if (featuredPool.length && random() < FEATURED_REPORT_PROBABILITY) {
    pool = featuredPool;
  } else if (regularPool.length) {
    pool = regularPool;
  } else if (otherPeoplePool.length) {
    pool = otherPeoplePool;
  } else {
    pool = reports;
  }

  return pool[Math.floor(random() * pool.length)] ?? pool[0] ?? null;
}

function renderContributionNudge(report: RecommendationRow): string {
  const title = escapeSlack(report.title);
  const author = escapeSlack(report.author_name);
  const summary = escapeSlack((report.summary ?? "").trim()).slice(0, 160);
  const reportUrl = new URL(`/reports/${encodeURIComponent(report.id)}`, HANABI_LOG_BASE_URL).toString();
  const createUrl = new URL("/reports/new", HANABI_LOG_BASE_URL).toString();
  const recommendation = summary
    ? `*あなたにおすすめの日報*\n「${title}」 — ${author}\n${summary}\n<${reportUrl}|読んでコメントする>`
    : `*あなたにおすすめの日報*\n「${title}」 — ${author}\n<${reportUrl}|読んでコメントする>`;

  return [
    "Hanabi Logからのお知らせです。",
    "",
    "ここ2週間、日報・コメントのコントリビューションがありません。",
    "最近やったことを日報に残すか、誰かの日報にコメントしてみてください。",
    "",
    recommendation,
    "",
    `<${createUrl}|日報を書く>`,
  ].join("\n");
}

async function claimEpisode(
  sql: ReturnType<typeof getDatabase>,
  member: InactiveMemberRow,
  key: string,
): Promise<boolean> {
  return sql.begin(async (tx) => {
    const lockKey = `contribution-nudge:${member.id}:${key}`;
    await tx`select pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const delivered = await tx`
      select 1
      from audit_events
      where action = 'contribution_nudge.delivered'
        and target_type = 'member'
        and target_id = ${member.id}
        and metadata_json ->> 'episode_key' = ${key}
      limit 1
    `;
    if (delivered.length) return false;

    const recentClaim = await tx`
      select 1
      from audit_events
      where action = 'contribution_nudge.claimed'
        and target_type = 'member'
        and target_id = ${member.id}
        and metadata_json ->> 'episode_key' = ${key}
        and occurred_at > now() - interval '5 minutes'
      limit 1
    `;
    if (recentClaim.length) return false;

    await tx`
      insert into audit_events (
        actor_member_id, actor_role, action, target_type, target_id, source, metadata_json
      ) values (
        null, null, 'contribution_nudge.claimed', 'member', ${member.id}, 'cron',
        ${tx.json({ episode_key: key })}
      )
    `;
    return true;
  });
}

async function recordDelivery(
  sql: ReturnType<typeof getDatabase>,
  input: {
    member: InactiveMemberRow;
    key: string;
    report: RecommendationRow;
    channelId: string | null;
    messageTs: string | null;
    featured: boolean;
  },
): Promise<void> {
  await sql`
    insert into audit_events (
      actor_member_id, actor_role, action, target_type, target_id, source, metadata_json
    ) values (
      null, null, 'contribution_nudge.delivered', 'member', ${input.member.id}, 'cron',
      ${sql.json({
        episode_key: input.key,
        recommended_report_id: input.report.id,
        recipient_slack_user_id: input.member.slack_user_id,
        slack_channel_id: input.channelId,
        slack_message_ts: input.messageTs,
        featured_recommendation: input.featured,
      })}
    )
  `;
}

async function recordFailure(
  sql: ReturnType<typeof getDatabase>,
  member: InactiveMemberRow,
  key: string,
  reason: string,
): Promise<void> {
  await sql`
    insert into audit_events (
      actor_member_id, actor_role, action, target_type, target_id, source, metadata_json
    ) values (
      null, null, 'contribution_nudge.failed', 'member', ${member.id}, 'cron',
      ${sql.json({ episode_key: key, reason })}
    )
  `;
}

export async function processContributionNudges(): Promise<ContributionNudgeResult> {
  if (isDemoMode || !env.SLACK_BOT_TOKEN || !env.SLACK_TEAM_ID) {
    return { checked: 0, delivered: 0, alreadyHandled: 0, failed: 0, skippedNoRecommendation: 0 };
  }

  const sql = getDatabase();
  const members = await sql<InactiveMemberRow[]>`
    select
      members.id::text as id,
      members.slack_user_id,
      members.display_name,
      members.created_at,
      activity.last_contribution_at
    from members
    left join lateral (
      select max(member_contribution_events.occurred_at) as last_contribution_at
      from member_contribution_events
      where member_contribution_events.member_id = members.id
    ) activity on true
    where members.is_active = true
      and members.slack_team_id = ${env.SLACK_TEAM_ID}
      and coalesce(activity.last_contribution_at, members.created_at)
        <= now() - interval '14 days'
    order by coalesce(activity.last_contribution_at, members.created_at), members.id
    limit 100
  `;

  const reports = await sql<RecommendationRow[]>`
    select
      reports.id::text as id,
      reports.author_id::text as author_id,
      reports.title,
      reports.summary,
      members.display_name as author_name,
      members.slack_user_id as author_slack_user_id,
      reports.published_at
    from reports
    join members on members.id = reports.author_id
    where reports.status = 'published'
      and reports.published_at is not null
    order by reports.published_at desc
    limit 100
  `;

  const result: ContributionNudgeResult = {
    checked: members.length,
    delivered: 0,
    alreadyHandled: 0,
    failed: 0,
    skippedNoRecommendation: 0,
  };
  const client = new WebClient(env.SLACK_BOT_TOKEN, {
    retryConfig: { retries: 0 },
    rejectRateLimitedCalls: true,
    timeout: 8_000,
  });
  const featuredSlackUserId = configuredFeaturedSlackUserId();

  for (const member of members) {
    const key = episodeKey(member);
    const claimed = await claimEpisode(sql, member, key);
    if (!claimed) {
      result.alreadyHandled += 1;
      continue;
    }

    const recommendation = pickContributionNudgeRecommendation(reports, {
      recipientMemberId: member.id,
      featuredSlackUserId,
    });
    if (!recommendation) {
      result.skippedNoRecommendation += 1;
      await recordFailure(sql, member, key, "NO_PUBLISHED_REPORT");
      continue;
    }

    const text = renderContributionNudge(recommendation);
    try {
      const message = await client.chat.postMessage({
        channel: member.slack_user_id,
        text,
        unfurl_links: false,
        unfurl_media: false,
      });
      await recordDelivery(sql, {
        member,
        key,
        report: recommendation,
        channelId: message.channel ?? null,
        messageTs: message.ts ?? null,
        featured: featuredSlackUserId !== null && recommendation.author_slack_user_id === featuredSlackUserId,
      });
      result.delivered += 1;
    } catch {
      result.failed += 1;
      await recordFailure(sql, member, key, "SLACK_DM_FAILED");
      console.error("Slack contribution nudge failed; retained for retry", { memberId: member.id });
    }
  }

  return result;
}
