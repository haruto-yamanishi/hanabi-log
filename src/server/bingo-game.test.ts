import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/types";
const state = vi.hoisted(() => ({ sql: undefined as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDatabase: () => state.sql }));
vi.mock("@/server/env", () => ({ isDemoMode: false }));
import { actOnBingo, getBingoSnapshot } from "./bingo-game";
const url = process.env.LIVE_BINGO_TEST_DATABASE_URL;
const host: CurrentUser = { id: "d5160b27-186c-45bd-84ec-71704239f44b", slackUserId: "U04SCJCFCSD", displayName: "Host", role: "admin", isActive: true };
const player: CurrentUser = { ...host, id: "00000000-0000-4000-8000-000000000001", slackUserId: "U_PLAYER", role: "member", displayName: "Player" };
const other: CurrentUser = { ...player, id: "00000000-0000-4000-8000-000000000002", slackUserId: "U_OTHER", displayName: "Other" };

describe.skipIf(!url)("persistent live bingo", () => {
  let sql: ReturnType<typeof postgres>;
  beforeAll(async () => {
    if (new URL(url!).hostname !== "127.0.0.1") throw new Error("Dedicated local test database required");
    sql = postgres(url!, { max: 8 }); state.sql = sql;
    await sql`create table members(id uuid primary key,display_name text,slack_user_id text)`;
    await sql`create table reports(id uuid primary key default gen_random_uuid(),author_id uuid,published_at timestamptz,status text)`;
    for (const user of [host, player, other]) await sql`insert into members values(${user.id},${user.displayName},${user.slackUserId})`;
    await sql.unsafe(await readFile("supabase/migrations/202610300001_halloween_bingo.sql", "utf8"));
    await sql.unsafe(await readFile("supabase/migrations/202610310001_live_bingo.sql", "utf8"));
    for (const date of ["2026-10-19T14:59:59Z", "2026-10-19T15:00:00Z", "2026-10-30T04:00:00Z", "2026-10-31T14:59:59Z", "2026-10-31T15:00:00Z"]) await sql`insert into reports(author_id,published_at,status) values(${player.id},${date},'published')`;
    await sql`insert into reports(author_id,published_at,status) values(${other.id},'2026-10-30T04:00:00Z','published'),(${player.id},'2026-10-30T05:00:00Z','draft')`;
  });
  beforeEach(async () => {
    await sql`truncate bingo_draws,bingo_cards`;
    await sql`update bingo_games set status='waiting',rule='report-support',started_at=null,started_by=null,finished_at=null,finished_by=null`;
  });
  afterAll(async () => { if (sql) await sql.end(); });
  async function reveal() { await sql`update bingo_draws set animation_at=now()-interval '12 seconds',reveal_at=now()-interval '6 seconds'`; }
  it("persists cards across concurrent reads and exposes only the viewer's card and count", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => getBingoSnapshot(player)));
    expect(results.every(result => JSON.stringify(result.card) === JSON.stringify(results[0].card))).toBe(true);
    expect(results[0].card?.reportCount).toBe(3);
    expect(results[0].card?.cells[12]).toBe(0);
    expect(results[0].canHost).toBe(false);
    expect((await getBingoSnapshot(host)).card).toBeNull();
    expect(Object.keys(results[0].entries[0]).sort()).toEqual(["display_name", "member_id", "qualified_at"]);
    expect((await sql`select * from bingo_cards`).length).toBe(1);
  });
  it("rejects participants and other admins, freezes all cards/counts at start", async () => {
    for (const user of [player, { ...other, role: "admin" as const }]) await expect(actOnBingo(user, { action: "start", rule: "uniform" })).rejects.toMatchObject({ status: 403 });
    const started = await actOnBingo(host, { action: "start", rule: "report-support" });
    expect(started.game).toMatchObject({ status: "live", cardCount: 2, rule: "report-support" });
    expect((await getBingoSnapshot(player)).card?.reportCount).toBe(3);
    // Repeated start cannot change the rule or reissue cards.
    await actOnBingo(host, { action: "start", rule: "uniform" });
    expect((await getBingoSnapshot(player)).game.rule).toBe("report-support");
  });
  it("serializes double clicks, retries exactly once, hides unrevealed numbers and blocks early next draws", async () => {
    await actOnBingo(host, { action: "start", rule: "uniform" });
    const action = { action: "draw" as const, expectedSequence: 0, requestId: crypto.randomUUID() };
    const results = await Promise.all([actOnBingo(host, action), actOnBingo(host, action)]);
    expect(results.every(result => result.draws.length === 1)).toBe(true);
    expect(results[0].draws[0].number).toBeNull();
    expect((await sql`select * from bingo_draws`).length).toBe(1);
    await expect(actOnBingo(host, { ...action, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "BINGO_STALE" });
    await expect(actOnBingo(host, { ...action, expectedSequence: 1, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "BINGO_DRAW_RUNNING" });
    await expect(actOnBingo(host, { action: "finish", expectedSequence: 1 })).rejects.toMatchObject({ code: "BINGO_DRAW_RUNNING" });
    await reveal();
    const first = await getBingoSnapshot(player); const second = await getBingoSnapshot(other);
    expect(first.draws).toEqual(second.draws); expect(first.draws[0].number).not.toBeNull();
    await actOnBingo(host, { action: "finish", expectedSequence: 1 });
    await expect(actOnBingo(host, { action: "start", rule: "uniform" })).rejects.toMatchObject({ code: "BINGO_FINISHED" });
  });
  it("exhausts 75 distinct balls, computes winners server-side and retains audit weights", async () => {
    await actOnBingo(host, { action: "start", rule: "report-support" });
    for (let i = 0; i < 75; i++) { await actOnBingo(host, { action: "draw", expectedSequence: i, requestId: crypto.randomUUID() }); await reveal(); }
    const result = await getBingoSnapshot(player);
    expect(new Set(result.draws.map(draw => draw.number)).size).toBe(75);
    expect(result.winners).toHaveLength(2); expect(result.winners.every(winner => winner.lines === 12)).toBe(true);
    const [audit] = await sql`select drawn_by,weights from bingo_draws where sequence=1`;
    expect(audit.drawn_by).toBe(host.id); expect(audit.weights).toHaveLength(75);
    await expect(actOnBingo(host, { action: "draw", expectedSequence: 75, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "BINGO_EXHAUSTED" });
  }, 30_000);
});
