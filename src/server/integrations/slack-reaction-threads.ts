import "server-only";
import type { WebClient } from "@slack/web-api";
import { getDatabase } from "@/server/db/client";

/** Events contain the reacted message ID, not its parent thread ID. */
export async function resolveSlackReactionThreads(client: WebClient): Promise<void> {
  const sql = getDatabase();
  // Reuse mappings for later emojis/users on an already resolved message.
  await sql`update slack_report_reactions pending set slack_thread_ts = known.slack_thread_ts
    from slack_report_reactions known
    where pending.slack_thread_ts is null and pending.processed_at is null
      and known.channel_id = pending.channel_id and known.message_ts = pending.message_ts
      and known.slack_thread_ts is not null`;
  await sql`update slack_report_reactions reaction set slack_thread_ts = reaction.message_ts
    from integration_bindings binding
    where reaction.slack_thread_ts is null and reaction.processed_at is null
      and binding.slack_channel_id = reaction.channel_id and binding.slack_message_ts = reaction.message_ts`;
  const unresolved = await sql`select channel_id, message_ts from slack_report_reactions
    where slack_thread_ts is null and processed_at is null and resolve_after <= now()
    group by channel_id, message_ts order by min(resolve_after), message_ts limit 5`;
  for (const message of unresolved) {
    try {
      const result = await client.reactions.get({
        channel: message.channel_id, timestamp: message.message_ts, full: true,
      });
      if (!result.message || result.message.ts !== message.message_ts) throw new Error("Slack message missing");
      const threadTs = (result.message as { thread_ts?: string }).thread_ts || result.message.ts;
      if (!threadTs) throw new Error("Slack thread ID missing");
      await sql`update slack_report_reactions set slack_thread_ts = ${threadTs}
        where channel_id = ${message.channel_id} and message_ts = ${message.message_ts}
          and slack_thread_ts is null`;
    } catch {
      // One deleted/inaccessible message must not starve later replies.
      await sql`update slack_report_reactions set resolve_after = now() + interval '5 minutes'
        where channel_id = ${message.channel_id} and message_ts = ${message.message_ts}
          and slack_thread_ts is null`;
      console.error("Slack reaction thread lookup failed; retained for retry");
    }
  }
}
