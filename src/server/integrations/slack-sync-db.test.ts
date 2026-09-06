import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Opt in with an empty LOCAL PostgreSQL database; never uses DATABASE_URL.
const state = vi.hoisted(() => ({ after: [] as (() => Promise<void>)[], sql: undefined as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => state.after.push(callback) }));
vi.mock("@/server/env", () => ({ isDemoMode: false, env: {
  SLACK_TEAM_ID: "T_TEST", SLACK_BOT_TOKEN: "test", SLACK_CHANNEL_ID: "C_TEST", SLACK_SIGNING_SECRET: "secret",
} }));
vi.mock("@/server/db/client", () => ({ getDatabase: () => state.sql }));
vi.mock("@/server/integrations/outbox", () => ({ processPendingJobs: vi.fn() }));
vi.mock("@slack/web-api", () => ({ WebClient: class {
  users = { info: async ({ user }: { user: string }) => ({ user: { name: user, profile: {} } }) };
} }));

import { POST } from "@/app/api/integrations/slack/events/route";
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
      "202608210002_log_ranking", "202609060001_slack_incoming_reports", "202609070001_slack_edits_and_reactions",
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

  it("does not resurrect a report deleted on the Web when Slack is edited", async () => {
    await sql`delete from reports`;
    await send({ type: "message", subtype: "message_changed", channel: "C_TEST",
      message: { ...message, text: "削除後の編集", edited: { ts: "1788735900.000001" } } });
    expect(await sql`select * from reports`).toHaveLength(0);
  });
});
