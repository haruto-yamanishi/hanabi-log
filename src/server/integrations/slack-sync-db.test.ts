import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Opt in with an empty LOCAL PostgreSQL database; never uses DATABASE_URL.
const state = vi.hoisted(() => ({ after: [] as (() => Promise<void>)[], sql: undefined as unknown,
  fileUpload: vi.fn(), fileInfo: vi.fn(), fileComplete: vi.fn(), fileDelete: vi.fn(),
  replies: vi.fn(), reactions: vi.fn(), postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "123.456" }),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => state.after.push(callback) }));
vi.mock("@/server/env", () => ({ isDemoMode: false, env: {
  APP_BASE_URL: "https://hanabi.test", SLACK_TEAM_ID: "T_TEST", SLACK_BOT_TOKEN: "test", SLACK_CHANNEL_ID: "C_TEST", SLACK_SIGNING_SECRET: "secret",
} }));
vi.mock("@/server/db/client", () => ({ getDatabase: () => state.sql }));
vi.mock("@/server/integrations/outbox", () => ({ processPendingJobs: vi.fn() }));
vi.mock("@slack/web-api", () => ({ WebClient: class {
  files = { getUploadURLExternal: state.fileUpload, info: state.fileInfo, completeUploadExternal: state.fileComplete, delete: state.fileDelete };
  reactions = { get: state.reactions };
  conversations = { replies: state.replies };
  chat = { postMessage: state.postMessage };
  users = { info: async ({ user }: { user: string }) => ({ user: { name: user, profile: {} } }) };
} }));

vi.mock("@/server/db/storage", async importOriginal => ({
  ...await importOriginal<typeof import("@/server/db/storage")>(),
  readStoredUpload: vi.fn(async () => ({ bytes: new Uint8Array([1,2,3]), mimeType: 'video/mp4' })),
}));

import { POST } from "@/app/api/integrations/slack/events/route";
import { importPastSlackReactions } from "./slack-reaction-backfill";
import { sendSystemDm } from "./system-dm";
import { listSystemDmHistory } from "./system-dm-history";
import { WebClient } from "@slack/web-api";
import { listLikeNotificationHistory } from "./like-notification-history";
import { cleanupOperationalData } from "@/server/maintenance/retention";
import { processLikeNotifications } from "./like-notifications";
import { PostgresReportRepository } from "@/server/repositories/postgres";

const url = process.env.SLACK_SYNC_TEST_DATABASE_URL;
describe.skipIf(!url)("Slack sync with PostgreSQL", () => {
  let sql: ReturnType<typeof postgres>;
  beforeAll(async () => {
    if (!url || new URL(url).hostname !== "127.0.0.1") throw new Error("Use a local test database");
    sql = postgres(url, { max: 1 });
    state.sql = sql;
    await sql`do $$ begin
      if not exists (select from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    end $$`;
    // The dedicated test database must be empty.
    for (const name of [
      "202608190001_hanabi_log", "202608200005_report_likes_and_weekly_digest",
      "202608200006_member_activity_and_report_approval", "202608210001_member_contribution_events",
      "202608210002_log_ranking", "202609060001_slack_incoming_reports", "202609070001_slack_edits_and_reactions", "202609070002_like_notifications", "202609070003_like_notification_history", "202609070006_api_rate_limits", "202609070007_slack_incoming_retry_state", "202610160001_comment_reaction_likes", "202610170001_unavailable_reaction_threads", "202609070004_audit_events", "202610170002_system_dm_deliveries", "202610230001_report_media_and_categories", "202610230003_comment_likes", "202610230004_usage_analytics", "202610230005_slack_video_uploads",
    ]) await sql.unsafe(await readFile(`supabase/migrations/${name}.sql`, "utf8"));
  });
  afterAll(async () => { if (sql) await sql.end(); });

  async function send(event: object) {
    const body = JSON.stringify({ type: "event_callback", team_id: "T_TEST", event });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = `v0=${createHmac("sha256", "secret").update(`v0:${timestamp}:${body}`).digest("hex")}`;
    const response = await POST(new Request("http://localhost/api/integrations/slack/events", {
      method: "POST", body, headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": signature },
    }));
    expect(response.status).toBe(200);
    for (const callback of state.after.splice(0)) await callback();
  }
  const message = { type: "message", channel: "C_TEST", user: "U_AUTHOR", ts: "1788735600.000001", text: "最初の本文" };
  const reaction = (type: string, emoji: string, time: number, user = "U_READER") => ({
    type, user, reaction: emoji, event_ts: `${time}.000001`,
    item: { type: "message", channel: "C_TEST", ts: message.ts },
  });

  it("updates a report without duplicating it or its contribution, and ignores stale edits", async () => {
    await send(message);
    await send(message);
    const edit = { type: "message", subtype: "message_changed", channel: "C_TEST",
      message: { ...message, text: "更新後の本文", edited: { ts: "1788735700.000001" } } };
    await send(edit);
    await send(edit);
    await send({ ...edit, message: { ...edit.message, text: "古い編集", edited: { ts: "1788735650.000001" } } });
    const reports = await sql`select * from reports`;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ activity_text: "更新後の本文", version: 2 });
    expect(await sql`select * from member_contribution_events`).toHaveLength(1);
    expect(await sql`select * from outbox_jobs where action = 'update'`).toHaveLength(1);
  });

  it("counts multiple emojis and a Web like once, preserving the remaining source on removal", async () => {
    await send(reaction("reaction_added", "heart", 1788735800));
    await send(reaction("reaction_added", "tada", 1788735801));
    expect(await sql`select * from report_likes`).toHaveLength(1);
    const [member] = await sql`select * from members where slack_user_id = 'U_READER'`;
    const [report] = await sql`select id from reports`;
    const actor = { id: member.id, slackUserId: "U_READER", displayName: "Reader", role: "member" as const, isActive: true };
    const repository = new PostgresReportRepository();
    expect((await repository.setReportLike(report.id, actor, true)).likeCount).toBe(1);
    expect((await repository.setReportLike(report.id, actor, false)).likeCount).toBe(1);
    await send(reaction("reaction_removed", "heart", 1788735802));
    expect(await sql`select * from report_likes`).toHaveLength(1);
    await repository.setReportLike(report.id, actor, true);
    await send(reaction("reaction_removed", "tada", 1788735803));
    expect(await sql`select * from report_likes`).toHaveLength(1);
    expect((await repository.setReportLike(report.id, actor, false)).likeCount).toBe(0);
    // A late add retry cannot undo the newer removal.
    await send(reaction("reaction_added", "tada", 1788735801));
    expect(await sql`select * from report_likes`).toHaveLength(0);
    await send(reaction("reaction_added", "heart", 1788735804));
    await send(reaction("reaction_added", "heart", 1788735805, "U_ANOTHER"));
    expect(await sql`select * from report_likes`).toHaveLength(2);
  });

  it("imports historical emojis once, preserves newer removals and existing Web likes", async () => {
    const [report] = await sql`select id from reports`;
    const [reader] = await sql`select id from members where slack_user_id = 'U_READER'`;
    await sql`update report_likes set web_liked = true where member_id = ${reader.id}`;
    const users = ["U_READER", "U_H0", "U_H1", "U_H2", "U_H3"];
    state.replies.mockResolvedValue({ messages: [{ ts: message.ts }] });
    state.reactions.mockResolvedValue({ message: { reactions: [
      { name: "heart", users, count: users.length },
      { name: "tada", users, count: users.length },
    ] } });
    expect(await importPastSlackReactions()).toMatchObject({ imported: true, remaining: 0, pending: 0 });
    expect(await sql`select * from report_likes where report_id = ${report.id}`).toHaveLength(6);
    const [removed] = await sql`select active from slack_report_reactions where user_id = 'U_READER' and reaction = 'tada'`;
    expect(removed.active).toBe(false);
    expect(await importPastSlackReactions()).toMatchObject({ imported: false, remaining: 0, pending: 0 });
    expect(state.reactions).toHaveBeenCalledTimes(1);
    await processLikeNotifications();
    await processLikeNotifications();
    expect(state.postMessage).toHaveBeenCalledTimes(1);
    expect(state.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ channel: "U_AUTHOR", text: expect.stringContaining("5人を超えました") }));
    const [history] = await listLikeNotificationHistory();
    expect(history).toMatchObject({ recipientName: "U_AUTHOR", recipientSlackUserId: "U_AUTHOR",
      recipientRecorded: true, status: "sent", thresholds: [5], messageText: state.postMessage.mock.calls[0][0].text });
    await sql`update members set display_name = '変更後の名前' where slack_user_id = 'U_AUTHOR'`;
    expect((await listLikeNotificationHistory())[0].recipientName).toBe("U_AUTHOR");
  });

  it("notifies only above each threshold, retries a failed DM, and does not repeat after an unlike", async () => {
    const [report] = await sql`select id from reports`;
    const repository = new PostgresReportRepository();
    for (let count = 7; count <= 31; count++) {
      const [member] = await sql`insert into members (slack_team_id, slack_user_id, display_name)
        values ('T_TEST', ${`U_L${count}`}, 'Reader') returning id`;
      await repository.setReportLike(report.id, { id: member.id, slackUserId: `U_L${count}`, displayName: "Reader", role: "member", isActive: true }, true);
      if (count === 11) state.postMessage.mockRejectedValueOnce(new Error("Slack unavailable"));
      await processLikeNotifications();
      if (count === 10) expect(state.postMessage).toHaveBeenCalledTimes(0);
      if (count === 11) {
        const [failed] = await sql`select * from report_like_notifications where threshold = 10`;
        expect(failed.sent_at).toBeNull();
        expect(failed.last_error).toBe("SLACK_DM_FAILED");
        await processLikeNotifications();
        expect(state.postMessage).toHaveBeenCalledTimes(1);
        await sql`update report_like_notifications set claimed_at = now() - interval '6 minutes' where threshold = 10`;
        await processLikeNotifications();
      }
      if (count === 20) expect(state.postMessage).toHaveBeenCalledTimes(2);
      if (count === 30) expect(state.postMessage).toHaveBeenCalledTimes(3);
    }
    expect(await sql`select * from report_like_notifications where sent_at is not null`).toHaveLength(4);
    expect(state.postMessage).toHaveBeenCalledTimes(4); // Three new milestones plus one failed attempt; the first was sent in the preceding test.
    const [member] = await sql`select id from members where slack_user_id = 'U_L31'`;
    const actor = { id: member.id, slackUserId: "U_L31", displayName: "Reader", role: "member" as const, isActive: true };
    await repository.setReportLike(report.id, actor, false);
    await repository.setReportLike(report.id, actor, true);
    await processLikeNotifications();
    expect(state.postMessage).toHaveBeenCalledTimes(4);
  });


  it("counts reply reactions once per report and preserves other messages and Web likes on removal", async () => {
    const [report] = await sql`select id from reports`;
    const before = (await sql`select * from report_likes`).length;
    const replyA = "1788736000.000001";
    const replyB = "1788736001.000001";
    state.reactions.mockImplementation(async ({ timestamp }: { timestamp: string }) => ({
      message: { ts: timestamp, thread_ts: message.ts },
    }));
    const event = (type: string, ts: string, time: number, emoji = "heart") => ({
      ...reaction(type, emoji, time, "U_COMMENT_READER"),
      item: { type: "message", channel: "C_TEST", ts },
    });
    await send(event("reaction_added", replyA, 1788736100));
    expect(await sql`select * from report_likes`).toHaveLength(before + 1);
    await send(event("reaction_added", replyB, 1788736101));
    await send(event("reaction_added", message.ts, 1788736102));
    await send(event("reaction_added", replyA, 1788736103, "tada"));
    expect(await sql`select * from report_likes`).toHaveLength(before + 1);
    await send(event("reaction_removed", message.ts, 1788736104));
    await send(event("reaction_removed", replyB, 1788736105));
    await send(event("reaction_removed", replyA, 1788736106, "heart"));
    expect(await sql`select * from report_likes`).toHaveLength(before + 1);
    // Exercise retry mode too: processed reactions on other messages must still count.
    process.env.SLACK_INGESTION_RETRY_MODE = "enforce";
    try {
      await send(event("reaction_added", replyB, 1788736107));
      await send(event("reaction_removed", replyA, 1788736108, "tada"));
      expect(await sql`select * from report_likes`).toHaveLength(before + 1);
      const [reader] = await sql`select id from members where slack_user_id = 'U_COMMENT_READER'`;
      const repository = new PostgresReportRepository();
      const actor = { id: reader.id, slackUserId: "U_COMMENT_READER", displayName: "Reader", role: "member" as const, isActive: true };
      await repository.setReportLike(report.id, actor, true);
      await send(event("reaction_removed", replyB, 1788736109));
      expect(await sql`select * from report_likes`).toHaveLength(before + 1);
      await repository.setReportLike(report.id, actor, false);
      expect(await sql`select * from report_likes`).toHaveLength(before);
      await send(event("reaction_added", replyB, 1788736107));
      expect(await sql`select * from report_likes`).toHaveLength(before);
    } finally {
      delete process.env.SLACK_INGESTION_RETRY_MODE;
    }
  });

  it("resolves replies that arrive before their report without importing unrelated threads", async () => {
    const parent = "1788737000.000001";
    const reply = "1788737001.000001";
    state.reactions.mockImplementation(async ({ timestamp }: { timestamp: string }) => ({
      message: { ts: timestamp, thread_ts: timestamp === reply ? parent : "99999.000001" },
    }));
    await send({ ...reaction("reaction_added", "heart", 1788737002, "U_EARLY"),
      item: { type: "message", channel: "C_TEST", ts: reply } });
    const before = (await sql`select * from report_likes`).length;
    await send({ ...reaction("reaction_added", "heart", 1788737003, "U_UNRELATED"),
      item: { type: "message", channel: "C_TEST", ts: "1788737004.000001" } });
    expect(await sql`select * from report_likes`).toHaveLength(before);
    await send({ ...message, ts: parent });
    expect(await sql`select * from report_likes`).toHaveLength(before + 1);
    const [binding] = await sql`select report_id from integration_bindings where slack_message_ts = ${parent}`;
    await sql`delete from reports where id = ${binding.report_id}`;
  });

  it("backfills paginated reply reactions without resurrecting newer removals", async () => {
    const [report] = await sql`select id from reports`;
    const before = (await sql`select * from report_likes`).length;
    const reply = "1788738000.000001";
    await sql`update integration_bindings set slack_thread_reactions_imported_at = null where report_id = ${report.id}`;
    await sql`insert into slack_report_reactions (channel_id, message_ts, user_id, reaction, active, event_ts)
      values ('C_TEST', ${reply}, 'U_REMOVED', 'heart', false, 1788738001)`;
    state.replies.mockImplementation(async (input: { cursor?: string; include_all_metadata?: boolean }) => {
      if (input.include_all_metadata) return { messages: [{ ts: message.ts }, { ts: reply, thread_ts: message.ts, text: "reply", user: "U_AUTHOR" }] };
      return input.cursor ? {
        messages: [{ ts: reply, thread_ts: message.ts, reactions: [{ name: "heart" }] }], has_more: false,
      } : {
        messages: [{ ts: message.ts }], has_more: true, response_metadata: { next_cursor: "next-page" },
      };
    });
    state.reactions.mockImplementation(async ({ timestamp }: { timestamp: string }) => ({
      message: { ts: timestamp, thread_ts: message.ts, reactions: timestamp === reply
        ? [{ name: "heart", count: 2, users: ["U_BACKFILL_COMMENT", "U_REMOVED"] }]
        : [] },
    }));
    expect(await importPastSlackReactions()).toMatchObject({ remaining: 1 });
    expect(await importPastSlackReactions()).toMatchObject({ remaining: 0, pending: 0 });
    expect(state.replies).toHaveBeenCalledWith(expect.objectContaining({ cursor: "next-page" }));
    expect(await sql`select * from report_likes`).toHaveLength(before + 1);
    expect(await sql`select * from members where slack_user_id = 'U_BACKFILL_COMMENT'`).toHaveLength(1);
    const [removed] = await sql`select active from slack_report_reactions where message_ts = ${reply} and user_id = 'U_REMOVED'`;
    expect(removed.active).toBe(false);
  });


  it("does not advance the backfill cursor when Slack omits reaction users", async () => {
    const [report] = await sql`select id from reports`;
    await sql`update integration_bindings set slack_thread_reactions_imported_at = null where report_id = ${report.id}`;
    state.replies.mockResolvedValue({ messages: [{ ts: message.ts }] });
    state.reactions.mockResolvedValue({ message: { reactions: [{ name: "heart", count: 2, users: ["U_PARTIAL"] }] } });
    await expect(importPastSlackReactions()).rejects.toThrow("全ユーザー");
    const [binding] = await sql`select * from integration_bindings where report_id = ${report.id}`;
    expect(binding.slack_thread_reactions_imported_at).toBeNull();
    expect(binding.slack_thread_reactions_cursor).toBeNull();
    expect(await sql`select * from slack_report_reactions where user_id = 'U_PARTIAL'`).toHaveLength(0);
  });

  it("preserves historical active reactions and removal tombstones during retention cleanup", async () => {
    const historical = await sql`select * from slack_report_reactions
      where processed_at is not null and event_ts = 0`;
    expect(historical.length).toBeGreaterThan(0);
    await sql`insert into slack_report_reactions (channel_id, message_ts, slack_thread_ts, user_id, reaction, active, event_ts, processed_at)
      values ('C_TEST', '1.000001', '1.000001', 'U_ORPHAN', 'heart', false, 0, now())`;
    await cleanupOperationalData();
    expect(await sql`select * from slack_report_reactions where user_id = 'U_ORPHAN'`).toHaveLength(0);
    for (const row of historical) {
      const [retained] = await sql`select * from slack_report_reactions where channel_id = ${row.channel_id}
        and message_ts = ${row.message_ts} and user_id = ${row.user_id} and reaction = ${row.reaction}`;
      expect(retained).toMatchObject({ active: row.active });
    }
  });

  it("records missing threads separately and continues importing available reports", async () => {
    const [report] = await sql`select id from reports`;
    state.replies.mockRejectedValueOnce({ data: { error: "ratelimited" } });
    await expect(importPastSlackReactions()).rejects.toMatchObject({ data: { error: "ratelimited" } });
    state.replies.mockRejectedValueOnce({ data: { error: "thread_not_found" } });
    expect(await importPastSlackReactions()).toMatchObject({ remaining: 0, unavailable: 1 });
    const [binding] = await sql`select * from integration_bindings where report_id = ${report.id}`;
    expect(binding.slack_thread_reactions_imported_at).toBeNull();
    expect(binding.slack_thread_reactions_error).toBe("thread_not_found");
    expect(await importPastSlackReactions()).toMatchObject({ imported: false, unavailable: 1 });
  });

  it("retains failed thread lookups for retry without blocking later comments", async () => {
    const before = (await sql`select * from report_likes`).length;
    state.reactions.mockRejectedValueOnce(new Error("Slack unavailable"));
    await send({ ...reaction("reaction_added", "heart", 1788739002, "U_RETRY"),
      item: { type: "message", channel: "C_TEST", ts: "1788739000.000001" } });
    const [pending] = await sql`select * from slack_report_reactions where user_id = 'U_RETRY'`;
    expect(pending.slack_thread_ts).toBeNull();
    expect(pending.processed_at).toBeNull();
    state.reactions.mockResolvedValue({ message: { ts: "1788739001.000001", thread_ts: message.ts } });
    await send({ ...reaction("reaction_added", "heart", 1788739003, "U_LATER"),
      item: { type: "message", channel: "C_TEST", ts: "1788739001.000001" } });
    expect(await sql`select * from report_likes`).toHaveLength(before + 1);
  });

  it("does not resurrect a report deleted on the Web when Slack is edited", async () => {
    await sql`delete from reports`;
    await send({ type: "message", subtype: "message_changed", channel: "C_TEST",
      message: { ...message, text: "削除後の編集", edited: { ts: "1788735900.000001" } } });
    expect(await sql`select * from reports`).toHaveLength(0);
  });
  it("unifies historical and new DMs, preserves snapshots, and deduplicates sends", async () => {
    const [member] = await sql`select id from members where slack_user_id = 'U_AUTHOR'`;
    await sql`insert into audit_events (action, target_type, target_id, metadata_json)
      values ('contribution_nudge.delivered', 'member', ${member.id}, ${sql.json({ episode_key: "old", recipient_slack_user_id: "U_AUTHOR" })})`;
    let history = await listSystemDmHistory();
    expect(history.filter(item => item.kind === "like").every(item => !item.id.startsWith("legacy-like:"))).toBe(true);
    expect(history.find(item => item.kind === "contribution_nudge")).toMatchObject({ status: "sent", messageText: null });
    const client = new WebClient("test");
    const input = { dedupeKey: "announcement:test", kind: "announcement" as const,
      recipientSlackUserId: "U_AUTHOR", recipientName: "送信時の名前", text: "確定した本文" };
    const before = state.postMessage.mock.calls.length;
    await sendSystemDm(client, input);
    await sendSystemDm(client, { ...input, text: "変わった本文" });
    expect(state.postMessage.mock.calls.length).toBe(before + 1);
    history = await listSystemDmHistory();
    expect(history.find(item => item.kind === "announcement")).toMatchObject({
      recipientName: "送信時の名前", messageText: "確定した本文", status: "sent", reportId: null,
    });
    await sendSystemDm(client, { ...input, dedupeKey: `nudge:${member.id}:old`, kind: "contribution_nudge" });
    history = await listSystemDmHistory();
    expect(history.filter(item => item.kind === "contribution_nudge")).toHaveLength(1);
    await sql`insert into system_dm_deliveries (dedupe_key, kind, recipient_slack_user_id, recipient_name, message_text, status, attempted_at)
      values ('ambiguous', 'announcement', 'U_AUTHOR', 'Name', 'Text', 'processing', now() - interval '6 minutes')`;
    await expect(sendSystemDm(client, { ...input, dedupeKey: "ambiguous" })).rejects.toThrow("DM_DELIVERY_IN_PROGRESS_OR_UNKNOWN");
    expect((await listSystemDmHistory()).find(item => item.messageText === "Text")?.status).toBe("unknown");
  });

  it("counts comment likes for both authors and preserves independent sources on unlike", async () => {
    const { setCommentLike, rememberComments, withCommentLikes } = await import("./comment-likes");
    const [owner] = await sql`insert into members(slack_team_id,slack_user_id,display_name) values('T_TEST','UOWNERLIKE','Owner') returning *`;
    const [writer] = await sql`insert into members(slack_team_id,slack_user_id,display_name) values('T_TEST','UWRITERLIKE','Writer') returning *`;
    const [liker] = await sql`insert into members(slack_team_id,slack_user_id,display_name) values('T_TEST','ULIKERLIKE','Liker') returning *`;
    const [report] = await sql`insert into reports(author_id,report_date,title,activity_area,content_category,activity_text,status,published_at)
      values(${owner.id},'2026-10-22','Comment likes','その他','進捗','test','published',now()) returning id`;
    await sql`insert into integration_bindings(report_id,slack_channel_id,slack_message_ts) values(${report.id},'C_LIKES','1800000000.000001')`;
    const actor = { id: liker.id, slackUserId: liker.slack_user_id, displayName: 'Liker', role: 'member' as const, isActive: true };
    const comments = ['1800000001.000001','1800000002.000001'].map(id => ({ id,body:'comment',source:'slack' as const,createdAt:new Date().toISOString(),author:{id:writer.id,displayName:'Writer'} }));
    await rememberComments(report.id, comments);
    await setCommentLike(report.id,comments[0].id,actor,true);
    await setCommentLike(report.id,comments[0].id,actor,true);
    await setCommentLike(report.id,comments[1].id,actor,true);
    expect(await sql`select * from report_likes where report_id=${report.id}`).toHaveLength(1);
    const repository = new PostgresReportRepository();
    expect((await repository.getLogRanking(owner.id)).likesReceived).toBe(1);
    expect((await repository.getLogRanking(writer.id)).likesReceived).toBe(2);
    await sql`insert into slack_report_reactions(channel_id,message_ts,slack_thread_ts,user_id,reaction,active,event_ts)
      values('C_LIKES',${comments[0].id},'1800000000.000001','ULIKERLIKE','heart',true,1),
            ('C_LIKES',${comments[0].id},'1800000000.000001','ULIKERLIKE','eyes',true,1)`;
    const { processIncomingSlackReports } = await import("./slack-incoming-store");
    await processIncomingSlackReports();
    expect((await withCommentLikes(report.id,comments,actor.id))[0].likeCount).toBe(1);
    await repository.setReportLike(report.id,actor,true);
    await setCommentLike(report.id,comments[0].id,actor,false);
    await setCommentLike(report.id,comments[1].id,actor,false);
    expect((await sql`select web_liked,web_comment_liked from report_likes where report_id=${report.id}`)[0]).toMatchObject({web_liked:true,web_comment_liked:false});
    expect((await repository.getLogRanking(writer.id)).likesReceived).toBe(1);
    await setCommentLike(report.id,comments[1].id,actor,true);
    await repository.setReportLike(report.id,actor,false);
    expect((await sql`select web_liked,web_comment_liked from report_likes where report_id=${report.id}`)[0]).toMatchObject({web_liked:false,web_comment_liked:true});
    await sql`update slack_report_reactions set active=false,processed_at=null where channel_id='C_LIKES'`;
    await processIncomingSlackReports();
    await setCommentLike(report.id,comments[1].id,actor,false);
    expect(await sql`select * from report_likes where report_id=${report.id}`).toHaveLength(0);
    expect((await repository.getLogRanking(writer.id)).likesReceived).toBe(0);
  });

  it("paginates newest, oldest and popularity with tied dates and like counts", async () => {
    const [owner] = await sql`insert into members(slack_team_id,slack_user_id,display_name) values('T_TEST','USORT','Sort owner') returning *`;
    const actor = { id: owner.id, slackUserId: 'USORT', displayName: 'Sort owner', role: 'admin' as const, isActive: true };
    const repository = new PostgresReportRepository();
    const ids = [];
    for (let index = 0; index < 5; index++) {
      const [report] = await sql`insert into reports(author_id,report_date,title,activity_area,content_category,activity_text,status,published_at)
        values(${owner.id},'2026-10-23',${`Sort ${index}`},'その他','進捗','test','published',${index < 3 ? '2026-10-22T12:00:00.000Z' : '2026-10-23T12:00:00.000Z'}) returning id`;
      ids.push(report.id);
      if (index < 2) await repository.setReportLike(report.id, actor, true);
    }
    for (const sort of ['newest', 'oldest', 'popular'] as const) {
      const all = await repository.listReports({ authorId: owner.id, sort, limit: 50 }, actor);
      const paginated: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await repository.listReports({ authorId: owner.id, sort, limit: 2, cursor }, actor);
        paginated.push(...page.reports.map(report => report.id));
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      expect(paginated).toEqual(all.reports.map(report => report.id));
      expect(new Set(paginated).size).toBe(5);
      if (sort === 'popular') expect(all.reports.map(report => report.likeCount)).toEqual([1,1,0,0,0]);
      if (sort === 'oldest') expect(all.reports[0].publishedAt).toBe('2026-10-22T12:00:00.000Z');
      if (sort === 'newest') expect(all.reports[0].publishedAt).toBe('2026-10-23T12:00:00.000Z');
    }
    const first = await repository.listReports({ authorId: owner.id, sort: 'popular', limit: 1 }, actor);
    await expect(repository.listReports({ sort: 'oldest', cursor: first.nextCursor! }, actor)).rejects.toMatchObject({ status: 422 });
  });

  it("records a visit once and reports unique viewers and expiring presence", async () => {
    const { recordPresence, recordReportView, getUsageAnalytics } = await import('@/server/analytics');
    const [member] = await sql`select * from members where slack_user_id = 'USORT'`;
    const [report] = await sql`select id from reports where author_id = ${member.id}`;
    const actor = { id: member.id, slackUserId: 'USORT', displayName: 'Sort owner', role: 'admin' as const, isActive: true };
    const visit = crypto.randomUUID();
    await recordReportView(report.id, member.id, visit);
    await recordReportView(report.id, member.id, visit);
    await recordReportView(report.id, member.id, crypto.randomUUID());
    await recordPresence(member.id);
    let stats = await getUsageAnalytics(actor);
    expect(stats.reports.find(item => item.id === report.id)).toMatchObject({ views: 2, viewers: 1 });
    expect(stats.members.find(item => item.id === member.id)?.online).toBe(true);
    await sql`update member_presence set last_seen_at = now() - interval '3 minutes' where member_id = ${member.id}`;
    stats = await getUsageAnalytics(actor);
    expect(stats.members.find(item => item.id === member.id)?.online).toBe(false);
    expect((await sql`select relrowsecurity from pg_class where relname in ('report_page_views','member_presence','analytics_settings')`).every(row => row.relrowsecurity)).toBe(true);
  });

  it("resumes a lost Slack video completion response without duplicates and deletes removed videos", async () => {
    const { createSlackVideoSync } = await import('./slack-videos');
    const [member] = await sql`select id from members where slack_user_id = 'USORT'`;
    const [row] = await sql`select id from reports where author_id = ${member.id}`;
    const repository = new PostgresReportRepository();
    const report = (await repository.getReport(row.id))!;
    report.attachments = [{ storagePath: 'owner/video.mp4', filename: 'video.mp4', mimeType: 'video/mp4', sizeBytes: 3, sortOrder: 0 }];
    const sync = createSlackVideoSync('test');
    state.fileUpload.mockResolvedValue({ file_id: 'FVIDEO', upload_url: 'https://files.slack.com/upload/test' });
    state.fileInfo.mockRejectedValueOnce({ data: { error: 'file_deleted' } });
    state.fileComplete.mockRejectedValueOnce(new Error('Lost response after sharing'));
    const upload = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', upload);
    try {
      await expect(sync(report, 'C_VIDEO', '123.001')).rejects.toThrow('Lost response');
      expect((await sql`select uploaded,shared from slack_video_uploads where report_id=${report.id}`)[0]).toMatchObject({ uploaded: true, shared: false });
      state.fileInfo.mockResolvedValue({ file: { shares: { public: { C_VIDEO: [{ thread_ts: '123.001' }] } } } });
      await sync(report, 'C_VIDEO', '123.001');
      await sync(report, 'C_VIDEO', '123.001');
      expect(state.fileUpload).toHaveBeenCalledTimes(1);
      expect(upload).toHaveBeenCalledTimes(1);
      expect(state.fileComplete).toHaveBeenCalledTimes(1);
      state.fileDelete.mockResolvedValue({ ok: true });
      await sync({ ...report, attachments: [] }, 'C_VIDEO', '123.001');
      expect(state.fileDelete).toHaveBeenCalledWith({ file: 'FVIDEO' });
      expect(await sql`select * from slack_video_uploads where report_id=${report.id}`).toHaveLength(0);
      // The lease prevents a concurrent worker from obtaining a new file ID.
      await sql`insert into slack_video_uploads(report_id,storage_path,channel_id,thread_ts,lease_until) values(${report.id},'owner/video.mp4','C_VIDEO','123.001',now()+interval '1 minute')`;
      await expect(sync(report, 'C_VIDEO', '123.001')).rejects.toThrow('SLACK_VIDEO_BUSY');
      expect(state.fileUpload).toHaveBeenCalledTimes(1);
      await sql`update slack_video_uploads set lease_until=null,file_id='FARCHIVED',shared=true where report_id=${report.id}`;
      await sync({ ...report, status: 'archived' }, 'C_VIDEO', '123.001');
      expect(state.fileDelete).toHaveBeenLastCalledWith({ file: 'FARCHIVED' });
    } finally { vi.unstubAllGlobals(); }
  });

});
