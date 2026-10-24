import "server-only";
import type { WebClient } from "@slack/web-api";
import { getDatabase } from "@/server/db/client";

export interface SystemDmInput {
  dedupeKey: string;
  kind: "like" | "contribution_nudge" | "announcement" | "publication";
  recipientSlackUserId: string;
  recipientName: string;
  text: string;
  blocks?: Extract<import("@slack/web-api").ChatPostMessageArguments, { blocks: unknown }>["blocks"];
  reportId?: string;
  reportTitle?: string;
}

/** Persist the exact recipient/text before sending; reuse successful deliveries on retries. */
export async function sendSystemDm(client: Pick<WebClient, "chat">, input: SystemDmInput) {
  const sql = getDatabase();
  const [claimed] = await sql`insert into system_dm_deliveries
    (dedupe_key, kind, recipient_slack_user_id, recipient_name, report_id, report_title, message_text, blocks, status)
    values (${input.dedupeKey}, ${input.kind}, ${input.recipientSlackUserId}, ${input.recipientName},
      ${input.reportId ?? null}, ${input.reportTitle ?? null}, ${input.text}, ${sql.json((input.blocks ?? []) as never)}, 'processing')
    on conflict (dedupe_key) do update set status = 'processing', attempted_at = now(), last_error = null
      where system_dm_deliveries.status = 'failed'
    returning *`;
  if (!claimed) {
    const [existing] = await sql`select status, slack_channel_id, slack_message_ts from system_dm_deliveries
      where dedupe_key = ${input.dedupeKey}`;
    if (existing?.status === "sent") return { channel: existing.slack_channel_id, ts: existing.slack_message_ts };
    // An interrupted/ambiguous delivery must not be automatically sent twice.
    throw new Error("DM_DELIVERY_IN_PROGRESS_OR_UNKNOWN");
  }
  let message;
  try {
    message = await client.chat.postMessage({
      channel: claimed.recipient_slack_user_id,
      text: claimed.kind === "publication" ? claimed.message_text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").slice(0,39000) : claimed.message_text,
      ...(claimed.kind === "publication" ? { mrkdwn: false, parse: "none" as const } : {}),
      ...(claimed.blocks?.length ? { blocks: claimed.blocks } : {}),
      unfurl_links: false,
      unfurl_media: false,
    });
  } catch (error) {
    await sql`update system_dm_deliveries set status = 'failed', last_error = 'SLACK_DM_FAILED'
      where id = ${claimed.id}`;
    throw error;
  }
  // Keep this outside the send catch: a storage failure after Slack accepted the
  // message leaves a visible unresolved delivery, rather than enabling a duplicate.
  await sql`update system_dm_deliveries set status = 'sent', sent_at = now(), last_error = null,
    slack_channel_id = ${message.channel ?? null}, slack_message_ts = ${message.ts ?? null}
    where id = ${claimed.id}`;
  return message;
}
