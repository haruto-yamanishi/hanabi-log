import postgres from "postgres";
import { WebClient } from "@slack/web-api";
import type { ActionsBlock, Button, KnownBlock } from "@slack/types";
import { intentSchema, publicationButton } from "../src/lib/publication-slack";

// Idempotent migration: edit existing bot messages rather than sending new DMs.
const apply = process.argv.includes("--apply");
if (!process.env.DATABASE_URL || (apply && !process.env.SLACK_BOT_TOKEN)) throw new Error("Required environment is missing");
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const client = new WebClient(process.env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true });
function upgrade(blocks: KnownBlock[], id: string): KnownBlock[] {
  return blocks.map(block => {
    if (block.type === "section" && block.text?.type === "plain_text") return { ...block, text: { ...block.text, text: block.text.text.replace("本人確認のため、ボタンからHanabi Logで回答してください。", "ボタンからSlack内で本文を確認して回答できます。") } };
    if (block.type !== "actions") return block;
    return { ...block, elements: (block as ActionsBlock).elements.map(element => {
      if (element.type !== "button" || !(element as Button).url) return element;
      const url = new URL((element as Button).url!);
      if (url.pathname !== `/publication-requests/${id}`) return element;
      const intent = intentSchema.safeParse(url.searchParams.get("decision") ?? "details");
      return publicationButton(id, intent.success ? intent.data : "details", (element as Button).text.text);
    }) } as ActionsBlock;
  });
}
try {
  const rows = await sql`select n.id as notification_id,n.request_id,n.blocks,n.message_text,
      d.id as delivery_id,d.status,d.slack_channel_id,d.slack_message_ts
    from publication_notifications n left join system_dm_deliveries d
      on d.dedupe_key = 'publication:' || n.request_id::text || ':' || n.request_version::text || ':' || n.recipient_id::text`;
  let changed = 0;
  for (const row of rows) {
    const blocks = upgrade(row.blocks, row.request_id);
    if (JSON.stringify(blocks) === JSON.stringify(row.blocks)) continue;
    changed++;
    if (!apply) continue;
    if (["processing", "unknown"].includes(row.status)) throw new Error("Resolve in-progress delivery before upgrading");
    const text = row.message_text.replace("本人確認のため、ボタンからHanabi Logで回答してください。", "ボタンからSlack内で本文を確認して回答できます。");
    if (row.status === "sent") {
      if (!row.slack_channel_id || !row.slack_message_ts) throw new Error("Sent message coordinates unavailable");
      await client.chat.update({ channel: row.slack_channel_id, ts: row.slack_message_ts, blocks,
        text: text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").slice(0,39000), parse: "none" });
    }
    await sql.begin(async tx => {
      await tx`update publication_notifications set blocks=${tx.json(blocks as never)},message_text=${text} where id=${row.notification_id}`;
      if (row.delivery_id) await tx`update system_dm_deliveries set blocks=${tx.json(blocks as never)},message_text=${text} where id=${row.delivery_id}`;
    });
  }
  console.log(JSON.stringify({ apply, messages: changed }));
} finally { await sql.end(); }
