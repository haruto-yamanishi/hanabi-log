import { randomInt } from "node:crypto";
import type { BingoCard, BingoRule } from "@/lib/bingo";

export function createBingoCard(): number[] {
  const cells = Array<number>(25);
  for (let col = 0; col < 5; col++) {
    const pool = Array.from({ length: 15 }, (_, i) => col * 15 + i + 1);
    for (let row = 0; row < 5; row++) cells[row * 5 + col] = pool.splice(randomInt(pool.length), 1)[0];
  }
  cells[12] = 0;
  return cells;
}
/** Public rule: at most +15%, averaged across all issued cards; counts freeze at start. */
export function bingoDrawWeights(cards: readonly BingoCard[], called: readonly number[], rule: BingoRule) {
  const used = new Set(called);
  return Array.from({ length: 75 }, (_, i) => i + 1).filter(number => !used.has(number)).map(number => {
    const support = rule === "report-support" ? cards.reduce((sum, card) =>
      sum + (card.cells.includes(number) ? Math.min(4, Math.max(0, card.reportCount - 1)) : 0), 0) : 0;
    return { number, weight: 100_000 + Math.floor(15_000 * support / (4 * Math.max(1, cards.length))) };
  });
}
export function pickBingoNumber(weights: ReturnType<typeof bingoDrawWeights>): number {
  if (!weights.length) throw new Error("All bingo numbers have been drawn");
  let ticket = randomInt(weights.reduce((sum, entry) => sum + entry.weight, 0));
  for (const entry of weights) { ticket -= entry.weight; if (ticket < 0) return entry.number; }
  throw new Error("Invalid bingo weights");
}
