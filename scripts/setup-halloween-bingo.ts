import { WebClient } from "@slack/web-api";
import { getDatabase } from "../src/server/db/client";
import { env, isDemoMode } from "../src/server/env";
import { bingoAnnouncement } from "../src/server/integrations/halloween-bingo";
const sql=getDatabase();
try {
  if(isDemoMode || !env.SLACK_BOT_TOKEN) throw new Error("Production credentials required");
  const channels=await sql`select distinct slack_channel_id from weekly_digest_deliveries where status='delivered'`;
  if(channels.length!==1) throw new Error("Confirm random channel before scheduling");
  const channel=channels[0].slack_channel_id as string;
  const [campaign]=await sql`select * from halloween_bingo_campaign where id='2026'`;
  console.log({channel,announceAt:campaign.announce_at,endsAt:campaign.ends_at,text:bingoAnnouncement});
  if(process.argv.includes("--apply")) {
    const client=new WebClient(env.SLACK_BOT_TOKEN,{retryConfig:{retries:0}});
    await client.conversations.history({channel,limit:1});
    // Persist intent before calling Slack; do not blindly retry an uncertain result.
    const [claimed]=await sql`update halloween_bingo_campaign set channel_id=${channel},scheduled_message_id='scheduling'
      where id='2026' and scheduled_message_id is null returning id`;
    if(!claimed) throw new Error("Already scheduled or unresolved: inspect Slack scheduled messages before retrying");
    const postAt=Math.floor(new Date(campaign.announce_at).getTime()/1000);
    if(postAt<=Date.now()/1000) throw new Error("Announcement time has passed");
    const message=await client.chat.scheduleMessage({channel,post_at:postAt,text:bingoAnnouncement,unfurl_links:false,unfurl_media:false});
    if(!message.scheduled_message_id) throw new Error("Schedule not confirmed");
    await sql`update halloween_bingo_campaign set scheduled_message_id=${message.scheduled_message_id} where id='2026'`;
    console.log({scheduledMessageId:message.scheduled_message_id,postAt:message.post_at});
  }
} finally {await sql.end();}
