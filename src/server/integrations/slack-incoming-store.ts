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
  for (const candidate of pending) {
    try {
      const existing = await sql`select id from members where slack_team_id = ${env.SLACK_TEAM_ID} and slack_user_id = ${candidate.user_id}`;
      const profile = existing.length ? undefined : (await client.users.info({ user: candidate.user_id })).user;
      if (!existing.length && (!profile || profile.is_bot || profile.deleted)) continue;
      await sql.begin(async (tx) => {
        const [message] = await tx`select * from slack_incoming_reports where channel_id = ${candidate.channel_id} and message_ts = ${candidate.message_ts} and processed_at is null for update skip locked`;
        if (!message) return;
        const body = message.body.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
        if (message.imported) {
          if (message.report_id) {
            const [report] = await tx`update reports set activity_text = ${body},
              summary = ${Array.from(body).slice(0, 100).join("")}, version = version + 1, updated_at = now()
              where id = ${message.report_id} and activity_text is distinct from ${body}
              returning id, status, version`;
            if (report && ["published", "archived"].includes(report.status)) {
              await tx`insert into outbox_jobs (report_id, target, action, report_version, dedupe_key)
                values (${report.id}, 'notion', 'update', ${report.version}, ${`${report.id}:notion:update:${report.version}`})
                on conflict (dedupe_key) do nothing`;
              await tx`update integration_bindings set notion_status = 'pending', notion_last_error = null where report_id = ${report.id}`;
            }
          }
          await tx`update slack_incoming_reports set processed_at = now() where channel_id = ${message.channel_id} and message_ts = ${message.message_ts}`;
          return;
        }
        const admin = (env.ADMIN_SLACK_USER_IDS ?? "").split(",").map(value => value.trim()).includes(candidate.user_id);
        if (!existing.length) {
          await tx`insert into members (slack_team_id, slack_user_id, display_name, avatar_url, role)
            values (${env.SLACK_TEAM_ID!}, ${candidate.user_id}, ${profile?.profile?.display_name || profile?.real_name || profile?.name || candidate.user_id}, ${profile?.profile?.image_192 ?? null}, ${admin ? "admin" : "member"})
            on conflict (slack_team_id, slack_user_id) do nothing`;
        }
        const [member] = await tx`select * from members where slack_team_id = ${env.SLACK_TEAM_ID!} and slack_user_id = ${candidate.user_id}`;
        const published = member.is_active || member.role === "admin";
        const occurredAt = new Date(Number(message.message_ts) * 1000);
        const reportDate = new Date(occurredAt.getTime() + 9 * 3600000).toISOString().slice(0, 10);
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
        await tx`update slack_incoming_reports set processed_at = now(), imported = true, report_id = ${report.id}
          where channel_id = ${message.channel_id} and message_ts = ${message.message_ts}`;
      });
    } catch {
      console.error("Slack report import failed; retained for retry", { channel: candidate.channel_id, ts: candidate.message_ts });
    }
  }
  await processSlackReactions(client);
}


async function processSlackReactions(client: WebClient): Promise<void> {
  const sql = getDatabase();
  // Join the binding so unrelated channel chatter and replies are never counted.
  const pending = await sql`select distinct reaction.channel_id, reaction.message_ts, reaction.user_id, binding.report_id
    from slack_report_reactions reaction
    join integration_bindings binding on binding.slack_channel_id = reaction.channel_id and binding.slack_message_ts = reaction.message_ts
    where reaction.processed_at is null limit 20`;
  for (const reaction of pending) {
    try {
      const existing = await sql`select id from members where slack_team_id = ${env.SLACK_TEAM_ID!} and slack_user_id = ${reaction.user_id}`;
      const profile = existing.length ? undefined : (await client.users.info({ user: reaction.user_id })).user;
      if (!existing.length && (!profile || profile.is_bot || profile.deleted)) {
        await sql`update slack_report_reactions set processed_at = now()
          where channel_id = ${reaction.channel_id} and message_ts = ${reaction.message_ts} and user_id = ${reaction.user_id}`;
        continue;
      }
      await sql.begin(async (tx) => {
        // Web likes use the same report lock, keeping concurrent toggles consistent.
        const report = await tx`select id from reports where id = ${reaction.report_id} for update`;
        if (!report.length) return;
        const states = await tx`select reaction, active from slack_report_reactions
          where channel_id = ${reaction.channel_id} and message_ts = ${reaction.message_ts} and user_id = ${reaction.user_id}
          order by reaction for update`;
        if (!existing.length) {
          const admin = (env.ADMIN_SLACK_USER_IDS ?? "").split(",").map(value => value.trim()).includes(reaction.user_id);
          await tx`insert into members (slack_team_id, slack_user_id, display_name, avatar_url, role)
            values (${env.SLACK_TEAM_ID!}, ${reaction.user_id}, ${profile?.profile?.display_name || profile?.real_name || profile?.name || reaction.user_id}, ${profile?.profile?.image_192 ?? null}, ${admin ? "admin" : "member"})
            on conflict (slack_team_id, slack_user_id) do nothing`;
        }
        const [member] = await tx`select id from members where slack_team_id = ${env.SLACK_TEAM_ID!} and slack_user_id = ${reaction.user_id}`;
        if (states.some(state => state.active)) {
          await tx`insert into report_likes (report_id, member_id, web_liked, slack_liked)
            values (${reaction.report_id}, ${member.id}, false, true)
            on conflict (report_id, member_id) do update set slack_liked = true`;
        } else {
          await tx`update report_likes set slack_liked = false where report_id = ${reaction.report_id} and member_id = ${member.id}`;
          await tx`delete from report_likes where report_id = ${reaction.report_id} and member_id = ${member.id} and not web_liked`;
        }
        // Mark only the rows locked above; newly arriving emojis remain pending.
        for (const state of states) {
          await tx`update slack_report_reactions set processed_at = now()
            where channel_id = ${reaction.channel_id} and message_ts = ${reaction.message_ts}
              and user_id = ${reaction.user_id} and reaction = ${state.reaction}`;
        }
      });
    } catch {
      console.error("Slack reaction sync failed; retained for retry", { channel: reaction.channel_id, ts: reaction.message_ts });
    }
  }
}
