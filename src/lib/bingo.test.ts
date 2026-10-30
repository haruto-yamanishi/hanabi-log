import { describe, expect, it } from "vitest";
import { bingoLines, bingoReachCount } from "./bingo";
import { bingoDrawWeights, createBingoCard, pickBingoNumber } from "@/server/bingo-rules";

describe("bingo cards and draws", () => {
  it("issues valid 5×5 cards with distinct numbers in B/I/N/G/O ranges and a free center", () => {
    const cards = Array.from({ length: 100 }, createBingoCard);
    for (const cells of cards) {
      expect(cells).toHaveLength(25); expect(cells[12]).toBe(0);
      expect(new Set(cells).size).toBe(25);
      cells.forEach((number, index) => { if (index !== 12) { expect(number).toBeGreaterThan(index % 5 * 15); expect(number).toBeLessThanOrEqual(index % 5 * 15 + 15); } });
    }
    expect(new Set(cards.map(card => card.join(","))).size).toBe(100);
  });
  it("marks rows, columns and both diagonals, with center already free", () => {
    const cells = Array.from({ length: 25 }, (_, i) => i === 12 ? 0 : i + 1);
    expect(bingoLines(cells, new Set())).toHaveLength(0);
    expect(bingoLines(cells, new Set([1, 2, 3, 4, 5]))).toEqual([[0, 1, 2, 3, 4]]);
    expect(bingoLines(cells, new Set([1, 6, 11, 16, 21]))).toHaveLength(1);
    expect(bingoLines(cells, new Set([1, 7, 19, 25, 5, 9, 17, 21]))).toHaveLength(2);
    expect(bingoReachCount(cells, new Set([1, 2, 3, 4]))).toBe(1);
  });
  it("keeps the public support bonus bounded, capped at 5 reports, and excludes drawn numbers", () => {
    const cells = createBingoCard();
    const weights = bingoDrawWeights([{ cells, reportCount: 100 }], [cells[0]], "report-support");
    expect(weights).toHaveLength(74);
    expect(weights.some(entry => entry.number === cells[0])).toBe(false);
    for (const entry of weights) expect(entry.weight).toBe(cells.includes(entry.number) ? 115_000 : 100_000);
    expect(weights).toEqual(bingoDrawWeights([{ cells, reportCount: 5 }], [cells[0]], "report-support"));
    expect(bingoDrawWeights([{ cells, reportCount: 1 }], [], "report-support").every(entry => entry.weight === 100_000)).toBe(true);
    expect(bingoDrawWeights([{ cells, reportCount: 100 }], [], "uniform").every(entry => entry.weight === 100_000)).toBe(true);
  });
  it("draws all 75 numbers exactly once and stops when exhausted", () => {
    const called: number[] = [];
    while (called.length < 75) called.push(pickBingoNumber(bingoDrawWeights([], called, "uniform")));
    expect(new Set(called).size).toBe(75);
    expect(() => pickBingoNumber([])).toThrow();
  });
});
