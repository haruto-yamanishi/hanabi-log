import "server-only";
import { BINGO_ANIMATION_MS, BINGO_REPORT_START, BINGO_REPORT_END, bingoLines, type BingoAction, type BingoSnapshot, type BingoCard, type BingoRule, type BingoStatus, type BingoEntry } from "@/lib/bingo";
import type { CurrentUser } from "@/lib/types";
import { getDatabase } from "@/server/db/client";
import { isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { bingoDrawWeights, createBingoCard, pickBingoNumber } from "./bingo-rules";

const GAME_ID = "2026";
const HOST_SLACK_ID = "U04SCJCFCSD";
type Game = { status: BingoStatus; rule: BingoRule; started_at: Date | string | null };
type Card = BingoCard & { memberId: string; displayName: string };
type Draw = { sequence: number; number: number; animation_at: Date | string; reveal_at: Date | string; request_id: string };
const iso = (date: Date | string) => new Date(date).toISOString();
export function canHostBingo(user: CurrentUser): boolean {
  return user.role === "admin" && (isDemoMode || user.slackUserId === HOST_SLACK_ID);
}
function snapshot(user: CurrentUser, game: Game, cards: Card[], draws: Draw[], entries: BingoEntry[], now: Date): BingoSnapshot {
  const visible = draws.filter(draw => new Date(draw.reveal_at).getTime() <= now.getTime());
  const called = new Set(visible.map(draw => draw.number));
  const winners = cards.flatMap(card => {
    const lines = bingoLines(card.cells, called).length;
    if (!lines) return [];
    const winningDraw = visible.find((_, i) => bingoLines(card.cells, new Set(visible.slice(0, i + 1).map(draw => draw.number))).length > 0)!.sequence;
    return [{ memberId: card.memberId, displayName: card.displayName, lines, winningDraw }];
  }).sort((a, b) => a.winningDraw - b.winningDraw || a.displayName.localeCompare(b.displayName, "ja"));
  const own = cards.find(card => card.memberId === user.id);
  return {
    serverTime: now.toISOString(), canHost: canHostBingo(user),
    game: { status: game.status, rule: game.rule, startedAt: game.started_at ? iso(game.started_at) : null, cardCount: cards.length },
    card: own ? { cells: own.cells, reportCount: own.reportCount } : null,
    draws: draws.map(draw => ({ sequence: draw.sequence, number: new Date(draw.reveal_at).getTime() <= now.getTime() ? draw.number : null, animationAt: iso(draw.animation_at), revealAt: iso(draw.reveal_at) })),
    winners, entries,
  };
}
function assertAction(game: Game, draws: Draw[], action: Exclude<BingoAction, { action: "start" }>, now: number) {
  if (game.status !== "live") throw new AppError("BINGO_NOT_LIVE", "抽選は開催中だけ操作できます", 409);
  if (action.expectedSequence !== draws.length) throw new AppError("BINGO_STALE", "別の操作が反映されています。最新の状態を確認してください", 409);
  const latest = draws.at(-1);
  if (latest && now < new Date(latest.reveal_at).getTime() + 1500) throw new AppError("BINGO_DRAW_RUNNING", "番号の発表が終わるまでお待ちください", 409);
  if (action.action === "draw" && draws.length >= 75) throw new AppError("BINGO_EXHAUSTED", "すべての番号を抽選しました", 409);
}

// Development only. Production state always lives in PostgreSQL.
type DemoGame = { game: Game; cards: Card[]; draws: Draw[]; entries: BingoEntry[] };
const demoGlobal = globalThis as typeof globalThis & { __hanabiLiveBingo?: DemoGame };
function demoState(user: CurrentUser): DemoGame {
  const state = demoGlobal.__hanabiLiveBingo ??= { game: { status: "waiting", rule: "report-support", started_at: null }, cards: [], draws: [], entries: [] };
  if (!state.cards.some(card => card.memberId === user.id) && state.game.status === "waiting") {
    state.cards.push({ memberId: user.id, displayName: user.displayName, cells: createBingoCard(), reportCount: 3 });
    state.entries.push({ member_id: user.id, display_name: user.displayName, qualified_at: new Date().toISOString() });
  }
  return state;
}
export async function getBingoSnapshot(user: CurrentUser): Promise<BingoSnapshot> {
  if (isDemoMode) { const state = demoState(user); return snapshot(user, state.game, state.cards, state.draws, state.entries, new Date()); }
  return getDatabase().begin(async tx => {
    // A shared lock makes the whole snapshot consistent with start/draw/finish.
    const [game] = await tx<Game[]>`select status,rule,started_at from bingo_games where id=${GAME_ID} for share`;
    if (!game) throw new AppError("BINGO_NOT_CONFIGURED", "ビンゴの準備中です", 503);
    if (game.status === "waiting") {
      const [eligible] = await tx`select member_id from halloween_bingo_entries where member_id=${user.id}`;
      if (eligible) {
        const [existing] = await tx`select member_id from bingo_cards where game_id=${GAME_ID} and member_id=${user.id}`;
        if (!existing) await tx`insert into bingo_cards(game_id,member_id,cells) values(${GAME_ID},${user.id},${createBingoCard()}) on conflict do nothing`;
      }
    }
    const cards = await tx<Card[]>`select c.member_id as "memberId",m.display_name as "displayName",c.cells,c.report_count as "reportCount" from bingo_cards c join members m on m.id=c.member_id where c.game_id=${GAME_ID}`;
    if (game.status === "waiting") {
      const own = cards.find(card => card.memberId === user.id);
      if (own) {
        const [count] = await tx`select count(*)::int as count from reports where author_id=${user.id} and status in ('published','archived') and published_at >= ${BINGO_REPORT_START} and published_at < ${BINGO_REPORT_END}`;
        own.reportCount = count.count;
      }
    }
    const draws = await tx<Draw[]>`select sequence,number,animation_at,reveal_at,request_id from bingo_draws where game_id=${GAME_ID} order by sequence`;
    const entries = await tx<BingoEntry[]>`select e.member_id,m.display_name,e.qualified_at from halloween_bingo_entries e join members m on m.id=e.member_id order by e.qualified_at,e.member_id`;
    const [clock] = await tx`select clock_timestamp() as now`;
    return snapshot(user, game, cards, draws, entries.map(entry => ({ ...entry, qualified_at: iso(entry.qualified_at) })), new Date(clock.now));
  });
}
export async function actOnBingo(user: CurrentUser, action: BingoAction): Promise<BingoSnapshot> {
  if (!canHostBingo(user)) throw new AppError("FORBIDDEN", "抽選は主催者だけが操作できます", 403);
  if (isDemoMode) {
    const state = demoState(user);
    if (action.action === "start") {
      if (state.game.status === "finished") throw new AppError("BINGO_FINISHED", "このビンゴは終了しています", 409);
      if (state.game.status === "waiting") state.game = { status: "live", rule: action.rule, started_at: new Date() };
    } else if (action.action !== "draw" || !state.draws.some(draw => draw.request_id === action.requestId)) {
      assertAction(state.game, state.draws, action, Date.now());
      if (action.action === "finish") state.game.status = "finished";
      else {
        const animation = Date.now() + 2000;
        state.draws.push({ sequence: state.draws.length + 1, number: pickBingoNumber(bingoDrawWeights(state.cards, state.draws.map(draw => draw.number), state.game.rule)), request_id: action.requestId, animation_at: new Date(animation), reveal_at: new Date(animation + BINGO_ANIMATION_MS) });
      }
    }
    return getBingoSnapshot(user);
  }
  await getDatabase().begin(async tx => {
    const [game] = await tx<Game[]>`select status,rule,started_at from bingo_games where id=${GAME_ID} for update`;
    if (!game) throw new AppError("BINGO_NOT_CONFIGURED", "ビンゴの準備中です", 503);
    if (action.action === "start") {
      if (game.status === "finished") throw new AppError("BINGO_FINISHED", "このビンゴは終了しています", 409);
      if (game.status === "live") return;
      const entries = await tx`select member_id from halloween_bingo_entries order by member_id`;
      if (!entries.length) throw new AppError("BINGO_NO_PLAYERS", "参加者が登録されてから開始してください", 409);
      for (const entry of entries) await tx`insert into bingo_cards(game_id,member_id,cells) values(${GAME_ID},${entry.member_id},${createBingoCard()}) on conflict do nothing`;
      await tx`update bingo_cards c set report_count=(select count(*) from reports r where r.author_id=c.member_id and r.status in ('published','archived') and r.published_at >= ${BINGO_REPORT_START} and r.published_at < ${BINGO_REPORT_END}) where c.game_id=${GAME_ID}`;
      await tx`update bingo_games set status='live',rule=${action.rule},started_at=clock_timestamp(),started_by=${user.id} where id=${GAME_ID}`;
      return;
    }
    const draws = await tx<Draw[]>`select sequence,number,animation_at,reveal_at,request_id from bingo_draws where game_id=${GAME_ID} order by sequence`;
    if (action.action === "draw" && draws.some(draw => draw.request_id === action.requestId)) return;
    const [clock] = await tx`select clock_timestamp() as now`;
    const now = new Date(clock.now).getTime();
    assertAction(game, draws, action, now);
    if (action.action === "finish") {
      await tx`update bingo_games set status='finished',finished_at=clock_timestamp(),finished_by=${user.id} where id=${GAME_ID}`;
      return;
    }
    const cards = await tx<BingoCard[]>`select cells,report_count as "reportCount" from bingo_cards where game_id=${GAME_ID}`;
    const weights = bingoDrawWeights(cards, draws.map(draw => draw.number), game.rule);
    const number = pickBingoNumber(weights);
    const animation = now + 2000;
    await tx`insert into bingo_draws(game_id,sequence,number,request_id,drawn_by,animation_at,reveal_at,weights)
      values(${GAME_ID},${draws.length + 1},${number},${action.requestId},${user.id},${new Date(animation)},${new Date(animation + BINGO_ANIMATION_MS)},${tx.json(weights)})`;
  });
  return getBingoSnapshot(user);
}
