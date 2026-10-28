import { WebClient } from "@slack/web-api";
import { createSlackMentionResolver } from "@/server/integrations/slack-mention-names";
import "server-only";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";
import type { SystemDmHistory } from "@/lib/system-dm-history";

export async function listSystemDmHistory(): Promise<SystemDmHistory[]> {
  if (isDemoMode) return [];
  const sql = getDatabase();
  const rows = await sql`
    with legacy_likes as (
      select 'legacy-like:' || n.report_id || ':' || coalesce(n.delivery_threshold, n.threshold) as id,
        'like' as kind, n.report_id, r.title as report_title,
        coalesce(n.recipient_name, m.display_name) as recipient_name,
        coalesce(n.recipient_slack_user_id, m.slack_user_id) as recipient_slack_user_id,
        n.recipient_slack_user_id is not null as recipient_recorded,
        n.message_text, n.sent_at, n.claimed_at as attempted_at,
        case when n.sent_at is not null then 'sent' when n.last_error is not null then 'failed'
          when n.claimed_at > now() - interval '5 minutes' then 'processing' else 'pending' end as status,
        n.last_error as error, coalesce(n.sent_at, n.claimed_at, r.created_at) as sort_at
      from report_like_notifications n
      join reports r on r.id = n.report_id join members m on m.id = r.author_id
      where not exists (select 1 from system_dm_deliveries dm
        where dm.dedupe_key = 'like:' || n.report_id || ':' || coalesce(n.delivery_threshold, n.threshold))
      group by n.report_id, coalesce(n.delivery_threshold, n.threshold), r.title, r.created_at,
        m.display_name, m.slack_user_id, n.recipient_name, n.recipient_slack_user_id,
        n.message_text, n.sent_at, n.claimed_at, n.last_error
    ), legacy_nudges as (
      select distinct on (a.target_id, a.metadata_json->>'episode_key')
        'legacy-nudge:' || a.id as id, 'contribution_nudge' as kind,
        r.id as report_id, r.title as report_title,
        coalesce(a.metadata_json->>'recipient_name', m.display_name, '記録なし') as recipient_name,
        coalesce(a.metadata_json->>'recipient_slack_user_id', m.slack_user_id, '記録なし') as recipient_slack_user_id,
        a.metadata_json ? 'recipient_slack_user_id' as recipient_recorded,
        a.metadata_json->>'message_text' as message_text,
        case when a.action = 'contribution_nudge.delivered' then a.occurred_at end as sent_at,
        a.occurred_at as attempted_at,
        case when a.action = 'contribution_nudge.delivered' then 'sent'
          when a.action = 'contribution_nudge.failed' then 'failed'
          when a.occurred_at > now() - interval '5 minutes' then 'processing' else 'unknown' end as status,
        a.metadata_json->>'reason' as error, a.occurred_at as sort_at
      from audit_events a
      left join members m on m.id::text = a.target_id
      left join reports r on r.id::text = a.metadata_json->>'recommended_report_id'
      where a.action in ('contribution_nudge.delivered', 'contribution_nudge.failed', 'contribution_nudge.claimed')
        and not exists (select 1 from system_dm_deliveries dm
          where dm.dedupe_key = 'nudge:' || a.target_id || ':' || (a.metadata_json->>'episode_key'))
      order by a.target_id, a.metadata_json->>'episode_key',
        (a.action = 'contribution_nudge.delivered') desc, a.occurred_at desc
    ), history as (
      select id::text, kind, report_id, report_title, recipient_name, recipient_slack_user_id,
        true as recipient_recorded, message_text, sent_at, attempted_at,
        case when status = 'processing' and attempted_at < now() - interval '5 minutes' then 'unknown' else status end as status,
        last_error as error, coalesce(sent_at, attempted_at, created_at) as sort_at
      from system_dm_deliveries
      union all select * from legacy_likes
      union all select * from legacy_nudges
    ) select * from history order by sort_at desc nulls last, id limit 100`;
  const resolveName = env.SLACK_BOT_TOKEN ? createSlackMentionResolver(new WebClient(env.SLACK_BOT_TOKEN, {
    retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 5000,
  })) : null;
  for (const row of rows) {
    if (resolveName && (!row.recipient_name || row.recipient_name === row.recipient_slack_user_id)) {
      row.recipient_name = await resolveName(row.recipient_slack_user_id) ?? row.recipient_name;
    }
  }
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return rows.map(row => ({
    id: row.id, kind: row.kind, reportId: row.report_id, reportTitle: row.report_title,
    recipientName: row.recipient_name, recipientSlackUserId: row.recipient_slack_user_id,
    recipientRecorded: row.recipient_recorded, messageText: row.message_text,
    sentAt: iso(row.sent_at), attemptedAt: iso(row.attempted_at), status: row.status, error: row.error,
  }));
}
