import "server-only";
import { WebClient } from "@slack/web-api";
import { after } from "next/server";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";

export function scheduleLikeNotifications(): void {
  after(async () => {
    try { await processLikeNotifications(); }
    catch { console.error("Like notification delivery failed; retained for cron retry"); }
  });
}

export async function processLikeNotifications(): Promise<void> {
  if (isDemoMode || !env.SLACK_BOT_TOKEN || !env.APP_BASE_URL) return;
  const sql = getDatabase();
  const client = new WebClient(env.SLACK_BOT_TOKEN, {
    retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 5000,
  });
  const pending = await sql`select distinct report_id from report_like_notifications
    where sent_at is null and (claimed_at is null or claimed_at < now() - interval '5 minutes') limit 10`;
  for (const candidate of pending) {
    const claimed = await sql.begin(async (tx) => {
      // Serialize delivery for a report, including overlapping milestones.
      const [report] = await tx`select reports.id, reports.title, members.slack_user_id
        from reports join members on members.id = reports.author_id
        where reports.id = ${candidate.report_id} and reports.status = 'published'
          and members.slack_team_id = ${env.SLACK_TEAM_ID ?? ""}
        for update of reports skip locked`;
      if (!report) return null;
      const busy = await tx`select 1 from report_like_notifications where report_id = ${report.id}
        and sent_at is null and claimed_at > now() - interval '5 minutes'`;
      if (busy.length) return null;
      const rows = await tx`update report_like_notifications set claimed_at = now(), last_error = null
        where report_id = ${report.id} and sent_at is null returning threshold`;
      if (!rows.length) return null;
      const highest = rows.reduce((left, right) => left.threshold > right.threshold ? left : right);
      return { id: report.id as string, title: report.title as string, slackUserId: report.slack_user_id as string, threshold: highest.threshold as number };
    });
    if (!claimed) continue;
    try {
      const url = new URL(`/reports/${claimed.id}`, env.APP_BASE_URL).toString();
      const title = String(claimed.title).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      // A user ID opens the bot's DM using the existing chat:write permission.
      await client.chat.postMessage({
        channel: claimed.slackUserId,
        text: `🎉 あなたの日報「${title}」のいいねが${claimed.threshold}人を超えました！\n<${url}|日報を見る>`,
        unfurl_links: false, unfurl_media: false,
      });
      await sql`update report_like_notifications set sent_at = now(), last_error = null
        where report_id = ${claimed.id} and threshold <= ${claimed.threshold} and sent_at is null`;
    } catch {
      // Keep the claim for five minutes to avoid rapid retries during outages.
      await sql`update report_like_notifications set last_error = 'SLACK_DM_FAILED'
        where report_id = ${claimed.id} and threshold <= ${claimed.threshold} and sent_at is null`;
      console.error("Slack like milestone DM failed; retained for retry", { reportId: claimed.id });
    }
  }
}
