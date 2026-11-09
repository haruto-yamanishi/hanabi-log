export const BINGO_COLUMNS = ["B", "I", "N", "G", "O"] as const;
export const BINGO_REPORT_START = "2026-10-19T15:00:00Z";
export const BINGO_REPORT_END = "2026-10-31T15:00:00Z";
export const BINGO_ANIMATION_MS = 4500;
export type BingoRule = "uniform" | "report-support";
export type BingoStatus = "waiting" | "live" | "finished";
export interface BingoDraw { sequence: number; number: number | null; animationAt: string; revealAt: string }
export interface BingoCard { cells: number[]; reportCount: number }
export interface BingoEntry { member_id: string; display_name: string; qualified_at: string }
export interface BingoWinner { memberId: string; displayName: string; lines: number; winningDraw: number }
export interface BingoSnapshot {
  serverTime: string;
  canHost: boolean;
  game: { status: BingoStatus; rule: BingoRule; startedAt: string | null; cardCount: number };
  card: BingoCard | null;
  draws: BingoDraw[];
  winners: BingoWinner[];
  entries: BingoEntry[];
}
export type BingoAction =
  | { action: "start"; rule: BingoRule }
  | { action: "draw"; expectedSequence: number; requestId: string }
  | { action: "finish"; expectedSequence: number };

export const BINGO_LINES = [
  ...Array.from({ length: 5 }, (_, row) => Array.from({ length: 5 }, (_, col) => row * 5 + col)),
  ...Array.from({ length: 5 }, (_, col) => Array.from({ length: 5 }, (_, row) => row * 5 + col)),
  [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
];
export function bingoLines(cells: readonly number[], called: ReadonlySet<number>): number[][] {
  return BINGO_LINES.filter(line => line.every(index => cells[index] === 0 || called.has(cells[index])));
}
export function bingoReachCount(cells: readonly number[], called: ReadonlySet<number>): number {
  return BINGO_LINES.filter(line => line.filter(index => cells[index] !== 0 && !called.has(cells[index])).length === 1).length;
}
export function bingoColumn(number: number): string { return BINGO_COLUMNS[Math.floor((number - 1) / 15)] ?? ""; }
