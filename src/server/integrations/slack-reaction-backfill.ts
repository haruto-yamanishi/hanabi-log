import "server-only";
import { WebClient } from "@slack/web-api";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { processIncomingSlackReports } from "@/server/integrations/slack-incoming-store";

/** One report per request keeps imports resumable and bounds Slack API usage. */
export async function importPastSlackReactions() {
  if (isDemoMode || !env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID) {
    throw new AppError("SLACK_NOT_CONFIGURED", "Slack連携の設定が必要です", 503);
  }
  const sql = getDatabase();
  const [binding] = await sql`select report_id, slack_channel_id, slack_message_ts from integration_bindings
    where slack_channel_id = ${env.SLACK_CHANNEL_ID} and slack_message_ts is not null
      and slack_reactions_imported_at is null order by report_id limit 1`;
  if (binding) {
    const client = new WebClient(env.SLACK_BOT_TOKEN, {
      retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 5000,
    });
    const result = await client.reactions.get({ channel: binding.slack_channel_id, timestamp: binding.slack_message_ts, full: true });
    if (!result.message) throw new AppError("SLACK_MESSAGE_MISSING", "Slackの元投稿を取得できませんでした", 502);
    const reactions = result.message.reactions ?? [];
    if (reactions.some(reaction => (reaction.count ?? 0) > new Set(reaction.users ?? []).size)) {
      throw new AppError("SLACK_REACTIONS_INCOMPLETE", "Slackがスタンプの全ユーザーを返しませんでした。人数を推測せず、取り込みを停止しました", 502);
    }
    await sql.begin(async (tx) => {
      for (const reaction of reactions) {
        if (!reaction.name) continue;
        for (const user of reaction.users ?? []) {
          // Live add/remove events always win, even if delivered during backfill.
          await tx`insert into slack_report_reactions (channel_id, message_ts, user_id, reaction, active, event_ts)
            values (${binding.slack_channel_id}, ${binding.slack_message_ts}, ${user}, ${reaction.name}, true, 0)
            on conflict do nothing`;
        }
      }
      await tx`update integration_bindings set slack_reactions_imported_at = now() where report_id = ${binding.report_id}`;
    });
  }
  await processIncomingSlackReports();
  const [remaining] = await sql`select count(*)::int as count from integration_bindings
    where slack_channel_id = ${env.SLACK_CHANNEL_ID} and slack_message_ts is not null and slack_reactions_imported_at is null`;
  const [pending] = await sql`select count(*)::int as count from slack_report_reactions reaction
    join integration_bindings binding on binding.slack_channel_id = reaction.channel_id and binding.slack_message_ts = reaction.message_ts
    where reaction.processed_at is null`;
  return { imported: Boolean(binding), remaining: remaining.count as number, pending: pending.count as number };
}
