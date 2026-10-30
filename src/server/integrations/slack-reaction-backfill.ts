import "server-only";
import { WebClient } from "@slack/web-api";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { processIncomingSlackReports } from "@/server/integrations/slack-incoming-store";

/** One small thread page per request bounds Slack API calls and checkpoints long threads. */
export async function importPastSlackReactions() {
  if (isDemoMode || !env.SLACK_BOT_TOKEN || !env.SLACK_CHANNEL_ID) {
    throw new AppError("SLACK_NOT_CONFIGURED", "Slack連携の設定が必要です", 503);
  }
  const sql = getDatabase();
  const [binding] = await sql`select report_id, slack_channel_id, slack_message_ts, slack_thread_reactions_cursor
    from integration_bindings
    where slack_channel_id = ${env.SLACK_CHANNEL_ID} and slack_message_ts is not null
      and slack_thread_reactions_imported_at is null and slack_thread_reactions_error is null order by report_id limit 1`;
  if (binding) {
    const client = new WebClient(env.SLACK_BOT_TOKEN, {
      retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 5000,
    });
    const page = await client.conversations.replies({
      channel: binding.slack_channel_id, ts: binding.slack_message_ts,
      cursor: binding.slack_thread_reactions_cursor || undefined, limit: 5,
    }).catch(async (error: unknown) => {
      const code = (error as { data?: { error?: string } })?.data?.error;
      if (code !== "thread_not_found" && code !== "message_not_found") throw error;
      await sql`update integration_bindings set slack_thread_reactions_error = ${code}
        where report_id = ${binding.report_id} and slack_thread_reactions_imported_at is null and slack_thread_reactions_error is null`;
      return null;
    });
    if (page) {
      if (!page.messages?.length) throw new AppError("SLACK_MESSAGE_MISSING", "Slackのスレッドを取得できませんでした", 502);
      const cursor = page.response_metadata?.next_cursor || null;
      if (page.has_more && !cursor) throw new AppError("SLACK_REPLIES_INCOMPLETE", "Slackの返信をすべて取得できませんでした", 502);
      // Fetch full user lists. Reply-list responses may truncate reaction users.
      const messages: { ts: string; reactions: { name?: string; count?: number; users?: string[] }[] }[] = [];
      for (const message of page.messages) {
        if (!message.ts || (message.ts !== binding.slack_message_ts && message.thread_ts !== binding.slack_message_ts)) {
          throw new AppError("SLACK_THREAD_MISMATCH", "Slackの返信先を確認できませんでした", 502);
        }
        if (message.ts !== binding.slack_message_ts && !message.reactions?.length) continue;
        const result = await client.reactions.get({ channel: binding.slack_channel_id, timestamp: message.ts, full: true });
        if (!result.message) throw new AppError("SLACK_MESSAGE_MISSING", "Slackの投稿を取得できませんでした", 502);
        const reactions = result.message.reactions ?? [];
        if (reactions.some(reaction => (reaction.count ?? 0) > new Set(reaction.users ?? []).size)) {
          throw new AppError("SLACK_REACTIONS_INCOMPLETE", "Slackがスタンプの全ユーザーを返しませんでした。人数を推測せず、取り込みを停止しました", 502);
        }
        messages.push({ ts: message.ts, reactions });
      }
      await sql.begin(async (tx) => {
        // Serialize concurrent imports and never move a saved cursor backwards.
        const [current] = await tx`select slack_thread_reactions_cursor, slack_thread_reactions_imported_at
          from integration_bindings where report_id = ${binding.report_id} for update`;
        if (!current || current.slack_thread_reactions_imported_at ||
          current.slack_thread_reactions_cursor !== binding.slack_thread_reactions_cursor) return;
        const rows = messages.flatMap(message => message.reactions.flatMap(reaction =>
          reaction.name ? (reaction.users ?? []).map(user => ({
            channel_id: binding.slack_channel_id as string,
            message_ts: message.ts,
            slack_thread_ts: binding.slack_message_ts as string,
            user_id: user,
            reaction: reaction.name!,
            active: true,
            event_ts: 0,
          })) : [],
        ));
        // One database round trip per page, even for heavily reacted-to messages.
        // Live add/remove events always win over these historical snapshots.
        if (rows.length) {
          await tx`insert into slack_report_reactions ${tx(rows,
            "channel_id", "message_ts", "slack_thread_ts", "user_id", "reaction", "active", "event_ts")}
            on conflict do nothing`;
        }
        if (messages.length) {
          await tx`update slack_report_reactions set slack_thread_ts = ${binding.slack_message_ts}
            where channel_id = ${binding.slack_channel_id} and message_ts in ${tx(messages.map(message => message.ts))}
              and slack_thread_ts is null`;
        }
        await tx`update integration_bindings set
          slack_thread_reactions_cursor = ${cursor},
          slack_thread_reactions_imported_at = case when ${cursor}::text is null then now() else null end,
          slack_reactions_imported_at = coalesce(slack_reactions_imported_at, now())
          where report_id = ${binding.report_id}`;
      });
    }
  }

  await processIncomingSlackReports();
  const [remaining] = await sql`select count(*)::int as count from integration_bindings
    where slack_channel_id = ${env.SLACK_CHANNEL_ID} and slack_message_ts is not null and slack_thread_reactions_imported_at is null and slack_thread_reactions_error is null`;
  const [pending] = await sql`select count(*)::int as count from slack_report_reactions reaction
    join integration_bindings binding on binding.slack_channel_id = reaction.channel_id
      and binding.slack_message_ts = coalesce(reaction.slack_thread_ts, reaction.message_ts)
    where reaction.processed_at is null`;
  const [unavailable] = await sql`select count(*)::int as count from integration_bindings
    where slack_channel_id = ${env.SLACK_CHANNEL_ID} and slack_thread_reactions_error is not null`;
  return { unavailable: unavailable.count as number, imported: Boolean(binding), remaining: remaining.count as number, pending: pending.count as number };
}
