import { appendMentionThreadLink, mentionThreadLink } from "@/lib/mention-thread-link";
import { createSlackMentionResolver } from "@/server/integrations/slack-mention-names";
import "server-only";
import { WebClient } from "@slack/web-api";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";
import { sendSystemDm } from "@/server/integrations/system-dm";

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export async function processMentionNotifications(reportId?: string) {
  const result = { claimed: 0, delivered: 0, failed: 0 };
  if (isDemoMode || !env.SLACK_BOT_TOKEN || !env.APP_BASE_URL) return result;
  const sql = getDatabase();
  const rows = await sql`update report_mention_notifications n
    set lease_until = now() + interval '10 minutes', attempts = attempts + 1
    where (report_id, target_id) in (
      select n.report_id, n.target_id from report_mention_notifications n join reports r on r.id=n.report_id
      where n.delivered_at is null and n.available_at <= now() and n.attempts < 8
        and (n.lease_until is null or n.lease_until < now()) and r.status='published'
        and exists (select 1 from integration_bindings b where b.report_id=n.report_id
          and b.slack_channel_id is not null and b.slack_message_ts is not null)
        and (${reportId ?? null}::uuid is null or n.report_id=${reportId ?? null}::uuid)
      order by n.created_at, n.report_id, n.target_id limit 10 for update of n skip locked)
    returning n.*`;
  result.claimed = rows.length;
  const client = new WebClient(env.SLACK_BOT_TOKEN, {
    retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 15000,
  });
  const resolveName = createSlackMentionResolver(client);
  for (const row of rows) {
    try {
      let recipients: string[] | null = row.recipients;
      if (!recipients) {
        recipients = row.target_id.startsWith("S")
          ? (await client.usergroups.users.list({ usergroup: row.target_id })).users ?? null
          : [row.target_id];
        if (!recipients) throw new Error("MENTION_GROUP_MEMBERS_MISSING");
        recipients = [...new Set(recipients)].filter(id => /^[UW][A-Z0-9]+$/.test(id));
        // Snapshot group membership so retries do not notify newly joined members.
        await sql`update report_mention_notifications set recipients=${sql.json(recipients)}
          where report_id=${row.report_id} and target_id=${row.target_id}`;
      }
      for (const recipient of recipients) {
        const [report] = await sql`select r.title, m.display_name, b.slack_channel_id, b.slack_message_ts, b.slack_permalink
          from reports r join members m on m.id=r.author_id join integration_bindings b on b.report_id=r.id
          where r.id=${row.report_id} and r.status='published'`;
        if (!report) throw new Error("REPORT_NO_LONGER_PUBLIC");
        const url = new URL(`/reports/${encodeURIComponent(row.report_id)}`, env.APP_BASE_URL).toString();
        await sendSystemDm(client, {
          dedupeKey: `mention:${row.report_id}:${recipient}`,
          kind: "announcement",
          recipientSlackUserId: recipient,
          recipientName: await resolveName(recipient) ?? recipient,
          reportId: row.report_id,
          reportTitle: report.title,
          text: appendMentionThreadLink(`日報からのお知らせ\nあなたがメンションされています。\n${escapeText(report.display_name)}さんの日報「${escapeText(report.title)}」\n<${url}|日報を読む>`, mentionThreadLink(report.slack_channel_id, report.slack_message_ts, report.slack_permalink)),
        });
      }
      await sql`update report_mention_notifications set delivered_at=now(), lease_until=null, last_error=null
        where report_id=${row.report_id} and target_id=${row.target_id}`;
      result.delivered++;
    } catch {
      await sql`update report_mention_notifications set lease_until=null, available_at=now()+interval '5 minutes',
        last_error='メンションDMの送信を確認できませんでした'
        where report_id=${row.report_id} and target_id=${row.target_id}`;
      result.failed++;
    }
  }
  return result;
}
