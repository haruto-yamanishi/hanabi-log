import "server-only";
import { WebClient } from "@slack/web-api";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";

export const bingoAnnouncement = `Happy Hanabi Halloween!!!
🎃 お土産Halloweenビンゴのお知らせ！🎃

<@U04SCJCFCSD> の日報での宣言どおり、11/6（金）19:00 JSTからの定例でお土産ビンゴを開催します。
宣言後（10/30 02:42 JST）から定例開始までに、一度でも日報を公開した人に挑戦権！ Slackからの日報も対象です。すでに書いてくれた人もちゃんと反映しています。
挑戦権を獲得した人は、このスレッドで随時 @メンションします。一人一回でOK！(もちろんたくさん書いてくれると嬉しいよ)
アプリ内から参加者一覧も確認できます。`;

export function normalizeBingoSlackText(text?: string): string | undefined {
  return text?.replaceAll(":jack_o_lantern:", "🎃").replace(/<(https:\/\/[^>|]+)>/g, "$1");
}

export function isBingoAnnouncement(text?: string): boolean {
  return normalizeBingoSlackText(text) === bingoAnnouncement;
}

export async function getBingoEntries() {
  if (isDemoMode) return [];
  return getDatabase()`select e.member_id, m.display_name, e.qualified_at from halloween_bingo_entries e
    join members m on m.id=e.member_id order by e.qualified_at, e.member_id`;
}

export async function processBingoNotifications() {
  if (isDemoMode || !env.SLACK_BOT_TOKEN) return;
  const sql = getDatabase();
  const client = new WebClient(env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, timeout: 15000 });
  // Serialize delivery across webhooks, publish callbacks and cron invocations.
  await sql.begin(async tx => {
    const [c] = await tx`select * from halloween_bingo_campaign where id='2026' and announce_at <= now() for update skip locked`;
    if (!c?.channel_id) return;
    let thread = c.thread_ts as string | null;
    if (!thread) {
      let cursor: string | undefined;
      do {
        const history = await client.conversations.history({ channel:c.channel_id, oldest:String(new Date(c.announce_at).getTime()/1000-1), latest:String(new Date(c.announce_at).getTime()/1000+3600), limit:100, cursor });
        thread = history.messages?.find(m => isBingoAnnouncement(m.text) && m.bot_id)?.ts ?? null;
        cursor = history.response_metadata?.next_cursor || undefined;
      } while (!thread && cursor);
      if (!thread) return;
      await tx`update halloween_bingo_campaign set thread_ts=${thread} where id='2026'`;
    }
    const entries = await tx`select e.*,m.slack_user_id from halloween_bingo_entries e join members m on m.id=e.member_id where notified_ts is null order by qualified_at limit 50`;
    for (const entry of entries) {
      const marker = `🎃 <@${entry.slack_user_id}> 日報ありがとう！ お土産Halloweenビンゴへの挑戦権を獲得しました！`;
      // Always reconcile the thread before sending: this also recovers an accepted
      // Slack request whose response or database transaction was lost.
      let cursor: string | undefined;
      let existing: string | undefined;
      do {
        const replies = await client.conversations.replies({ channel:c.channel_id, ts:thread, limit:100, cursor });
        existing = replies.messages?.find(m => normalizeBingoSlackText(m.text) === marker && m.bot_id)?.ts;
        cursor = replies.response_metadata?.next_cursor || undefined;
      } while (!existing && cursor);
      if (!existing) {
        const sent = await client.chat.postMessage({ channel:c.channel_id, thread_ts:thread, text:marker, unfurl_links:false, unfurl_media:false });
        if (!sent.ts) throw new Error("BINGO_SEND_UNCONFIRMED");
        existing = sent.ts;
      }
      await tx`update halloween_bingo_entries set notified_ts=${existing},attempted_at=now() where member_id=${entry.member_id}`;
    }
  });
}
