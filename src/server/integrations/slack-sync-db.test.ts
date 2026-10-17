import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Opt in with an empty LOCAL PostgreSQL database; never uses DATABASE_URL.
const state = vi.hoisted(() => ({ after: [] as (() => Promise<void>)[], sql: undefined as unknown,
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
  reactions = { get: state.reactions };
  conversations = { replies: state.replies };
  chat = { postMessage: state.postMessage };
  users = { info: async ({ user }: { user: string }) => ({ user: { name: user, profile: {} } }) };
} }));

import { POST } from "@/app/api/integrations/slack/events/route";
import { importPastSlackReactions } from "./slack-reaction-backfill";
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
    // The dedicated test database must be empty.
    for (const name of [
      "202608190001_hanabi_log", "202608200005_report_likes_and_weekly_digest",
      "202608200006_member_activity_and_report_approval", "202608210001_member_contribution_events",
      "202608210002_log_ranking", "202609060001_slack_incoming_reports", "202609070001_slack_edits_and_reactions", "202609070002_like_notifications", "202609070003_like_notification_history", "202609070006_api_rate_limits", "202609070007_slack_incoming_retry_state", "202610160001_comment_reaction_likes", "202610170001_unavailable_reaction_threads",
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
    state.replies.mockResolvedValueOnce({
      messages: [{ ts: message.ts }], has_more: true, response_metadata: { next_cursor: "next-page" },
    }).mockResolvedValueOnce({
      messages: [{ ts: reply, thread_ts: message.ts, reactions: [{ name: "heart" }] }], has_more: false,
    });
    state.reactions.mockImplementation(async ({ timestamp }: { timestamp: string }) => ({
      message: { ts: timestamp, thread_ts: message.ts, reactions: timestamp === reply
        ? [{ name: "heart", count: 2, users: ["U_BACKFILL_COMMENT", "U_REMOVED"] }]
        : [] },
    }));
    expect(await importPastSlackReactions()).toMatchObject({ remaining: 1 });
    expect(await importPastSlackReactions()).toMatchObject({ remaining: 0, pending: 0 });
    expect(state.replies).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "next-page" }));
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
});
