import { seasonalEventForDate } from "./seasonal-events";

/** Fixed JST offset: Japan has no daylight-saving transitions. */
export function isHalloweenSeason(now: Date): boolean {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return Number.isFinite(jst.getTime()) && seasonalEventForDate(jst.toISOString().slice(0, 10))?.id === "halloween";
}

export function nextJstMidnight(now: Date): number {
  const offset = 9 * 60 * 60 * 1000;
  const jst = new Date(now.getTime() + offset);
  return Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() + 1) - offset;
}
