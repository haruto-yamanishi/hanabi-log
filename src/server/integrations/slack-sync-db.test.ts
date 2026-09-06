import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Opt in with an empty LOCAL PostgreSQL database; never uses DATABASE_URL.
const state = vi.hoisted(() => ({ after: [] as (() => Promise<void>)[], sql: undefined as unknown,
  reactions: vi.fn(), postMessage: vi.fn().mockResolvedValue({ ok: true, ts: "123.456" }),
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
  chat = { postMessage: state.postMessage };
  users = { info: async ({ user }: { user: string }) => ({ user: { name: user, profile: {} } }) };
} }));

import { POST } from "@/app/api/integrations/slack/events/route";
import { importPastSlackReactions } from "./slack-reaction-backfill";
import { listLikeNotificationHistory } from "./like-notification-history";
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
      "202608210002_log_ranking", "202609060001_slack_incoming_reports", "202609070001_slack_edits_and_reactions", "202609070002_like_notifications", "202609070003_like_notification_history",
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
      if (count === 10) expect(state.postMessage).toHaveBeenCalledTimes(1);
      if (count === 11) {
        const [failed] = await sql`select * from report_like_notifications where threshold = 10`;
        expect(failed.sent_at).toBeNull();
        expect(failed.last_error).toBe("SLACK_DM_FAILED");
        await processLikeNotifications();
        expect(state.postMessage).toHaveBeenCalledTimes(2);
        await sql`update report_like_notifications set claimed_at = now() - interval '6 minutes' where threshold = 10`;
        await processLikeNotifications();
      }
      if (count === 20) expect(state.postMessage).toHaveBeenCalledTimes(3);
      if (count === 30) expect(state.postMessage).toHaveBeenCalledTimes(4);
    }
    expect(await sql`select * from report_like_notifications where sent_at is not null`).toHaveLength(4);
    expect(state.postMessage).toHaveBeenCalledTimes(5); // Four milestones plus one failed attempt.
    const [member] = await sql`select id from members where slack_user_id = 'U_L31'`;
    const actor = { id: member.id, slackUserId: "U_L31", displayName: "Reader", role: "member" as const, isActive: true };
    await repository.setReportLike(report.id, actor, false);
    await repository.setReportLike(report.id, actor, true);
    await processLikeNotifications();
    expect(state.postMessage).toHaveBeenCalledTimes(5);
  });

  it("does not resurrect a report deleted on the Web when Slack is edited", async () => {
    await sql`delete from reports`;
    await send({ type: "message", subtype: "message_changed", channel: "C_TEST",
      message: { ...message, text: "削除後の編集", edited: { ts: "1788735900.000001" } } });
    expect(await sql`select * from reports`).toHaveLength(0);
  });
});
