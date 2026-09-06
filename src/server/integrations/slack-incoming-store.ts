import "server-only";
import { WebClient } from "@slack/web-api";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";
import { resolveReportTitle } from "@/lib/report-title";

export async function processIncomingSlackReports(): Promise<void> {
  if (isDemoMode || !env.SLACK_TEAM_ID || !env.SLACK_BOT_TOKEN) return;
  const sql = getDatabase();
  const client = new WebClient(env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, timeout: 5000 });
  const pending = await sql`select * from slack_incoming_reports where processed_at is null order by created_at limit 20`;
  for (const message of pending) {
    try {
      const existing = await sql`select id from members where slack_team_id = ${env.SLACK_TEAM_ID} and slack_user_id = ${message.user_id}`;
      const profile = existing.length ? undefined : (await client.users.info({ user: message.user_id })).user;
      if (!existing.length && (!profile || profile.is_bot || profile.deleted)) continue;
      await sql.begin(async (tx) => {
        const locked = await tx`select * from slack_incoming_reports where channel_id = ${message.channel_id} and message_ts = ${message.message_ts} and processed_at is null for update skip locked`;
        if (!locked.length) return;
        const admin = (env.ADMIN_SLACK_USER_IDS ?? "").split(",").map(value => value.trim()).includes(message.user_id);
        if (!existing.length) {
          await tx`insert into members (slack_team_id, slack_user_id, display_name, avatar_url, role)
            values (${env.SLACK_TEAM_ID!}, ${message.user_id}, ${profile?.profile?.display_name || profile?.real_name || profile?.name || message.user_id}, ${profile?.profile?.image_192 ?? null}, ${admin ? "admin" : "member"})
            on conflict (slack_team_id, slack_user_id) do nothing`;
        }
        const [member] = await tx`select * from members where slack_team_id = ${env.SLACK_TEAM_ID!} and slack_user_id = ${message.user_id}`;
        const published = member.is_active || member.role === "admin";
        const occurredAt = new Date(Number(message.message_ts) * 1000);
        const reportDate = new Date(occurredAt.getTime() + 9 * 3600000).toISOString().slice(0, 10);
        const body = message.body.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
        const [report] = await tx`insert into reports (author_id, report_date, title, summary, activity_area, content_category, activity_text, status, published_at)
          values (${member.id}, ${reportDate}, ${resolveReportTitle("", member.display_name)}, ${Array.from(body).slice(0, 100).join("")}, 'その他', '進捗', ${body}, ${published ? "published" : "pending_approval"}, ${published ? occurredAt : null}) returning id`;
        const permalink = `https://app.slack.com/archives/${message.channel_id}/p${message.message_ts.replace(".", "")}`;
        await tx`insert into integration_bindings (report_id, slack_channel_id, slack_message_ts, slack_permalink, slack_source_message, slack_status)
          values (${report.id}, ${message.channel_id}, ${message.message_ts}, ${permalink}, true, 'delivered')`;
        if (published) {
          await tx`insert into member_contribution_events (member_id, report_id, occurred_at, kind, event_key)
            values (${member.id}, ${report.id}, ${occurredAt}, 'report', ${`report:${report.id}`}) on conflict (event_key) do nothing`;
          await tx`insert into outbox_jobs (report_id, target, action, report_version, dedupe_key)
            values (${report.id}, 'notion', 'publish', 1, ${`${report.id}:notion:publish:1`})`;
        }
        await tx`update slack_incoming_reports set processed_at = now() where channel_id = ${message.channel_id} and message_ts = ${message.message_ts}`;
      });
    } catch {
      console.error("Slack report import failed; retained for retry", { channel: message.channel_id, ts: message.message_ts });
    }
  }
}
