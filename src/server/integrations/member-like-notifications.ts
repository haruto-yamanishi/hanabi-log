import "server-only";
import type { WebClient } from "@slack/web-api";
import { getDatabase } from "@/server/db/client";
import { env } from "@/server/env";

/** Uses the existing delivery cycle and retry interval, without a separate scheduler. */
export async function processMemberLikeNotifications(client: WebClient): Promise<void> {
  const sql = getDatabase();
  const pending = await sql`select distinct member_id from member_like_notifications
    where sent_at is null and (claimed_at is null or claimed_at < now() - interval '5 minutes') limit 10`;
  for (const candidate of pending) {
    const claimed = await sql.begin(async (tx) => {
      const [member] = await tx`select id, display_name, slack_user_id from members
        where id = ${candidate.member_id} and slack_team_id = ${env.SLACK_TEAM_ID ?? ""}
        for update skip locked`;
      if (!member) return null;
      const busy = await tx`select 1 from member_like_notifications where member_id = ${member.id}
        and sent_at is null and claimed_at > now() - interval '5 minutes'`;
      if (busy.length) return null;
      const rows = await tx`update member_like_notifications set claimed_at = now(), last_error = null
        where member_id = ${member.id} and sent_at is null returning threshold`;
      if (!rows.length) return null;
      const threshold = rows.reduce((highest, row) => BigInt(row.threshold) > highest ? BigInt(row.threshold) : highest, 0n).toString();
      return { id: member.id as string, name: member.display_name as string, slackUserId: member.slack_user_id as string, threshold };
    });
    if (!claimed) continue;
    try {
      const url = new URL("/me", env.APP_BASE_URL!).toString();
      const count = BigInt(claimed.threshold).toLocaleString("ja-JP");
      const text = `🎉 あなたの日報が受け取った累計いいねが${count}件に到達しました！\nいつも活動の共有をありがとうございます！\n<${url}|自分の活動を見る>`;
      await sql`update member_like_notifications set recipient_slack_user_id = ${claimed.slackUserId},
        recipient_name = ${claimed.name}, message_text = ${text}, delivery_threshold = ${claimed.threshold}
        where member_id = ${claimed.id} and threshold <= ${claimed.threshold} and sent_at is null`;
      const message = await client.chat.postMessage({ channel: claimed.slackUserId, text, unfurl_links: false, unfurl_media: false });
      await sql`update member_like_notifications set sent_at = now(), last_error = null,
        slack_channel_id = ${message.channel ?? null}, slack_message_ts = ${message.ts ?? null}
        where member_id = ${claimed.id} and threshold <= ${claimed.threshold} and sent_at is null`;
    } catch {
      await sql`update member_like_notifications set last_error = 'SLACK_DM_FAILED'
        where member_id = ${claimed.id} and threshold <= ${claimed.threshold} and sent_at is null`;
      console.error("Slack cumulative like DM failed; retained for retry", { memberId: claimed.id });
    }
  }
}
