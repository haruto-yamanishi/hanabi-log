import { WebClient } from "@slack/web-api";
import { getDatabase } from "../src/server/db/client";
import { env, isDemoMode } from "../src/server/env";
import { appendMentionThreadLink, mentionThreadLink } from "../src/lib/mention-thread-link";
const sql = getDatabase();
try {
  if (isDemoMode || !env.SLACK_BOT_TOKEN) throw new Error("Live Slack configuration required");
  const apply = process.argv.includes("--apply");
  const client = new WebClient(env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 15000 });
  const rows = await sql`select dm.id,dm.message_text,dm.slack_channel_id as dm_channel,dm.slack_message_ts as dm_ts,
    b.slack_channel_id,b.slack_message_ts,b.slack_permalink from system_dm_deliveries dm
    join reports r on r.id=dm.report_id join integration_bindings b on b.report_id=r.id
    where dm.dedupe_key like 'mention:%' and dm.status='sent' and r.status='published'
      and dm.slack_channel_id is not null and dm.slack_message_ts is not null
      and b.slack_channel_id is not null and b.slack_message_ts is not null`;
  let updated = 0;
  for (const row of rows) {
    const text = appendMentionThreadLink(row.message_text,mentionThreadLink(row.slack_channel_id,row.slack_message_ts,row.slack_permalink));
    if (text === row.message_text) continue;
    if (apply) {
      // Updates the existing message ID; never calls chat.postMessage.
      await client.chat.update({channel:row.dm_channel,ts:row.dm_ts,text,blocks:[]});
      const saved = await sql`update system_dm_deliveries set message_text=${text}
        where id=${row.id} and message_text=${row.message_text} returning id`;
      if (!saved.length) throw new Error("DM_HISTORY_CHANGED_DURING_UPDATE");
      await new Promise(resolve=>setTimeout(resolve,1100));
    }
    updated++;
  }
  console.log(JSON.stringify({apply,matched:rows.length,updated}));
} finally { await sql.end(); }
