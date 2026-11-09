import { isHalloweenSeason } from "./halloween-season";

export type SeasonalScene = "none" | "halloween" | "autumn" | "winter" | "christmas";
export function seasonalSceneForDate(now: Date): SeasonalScene {
  if (!Number.isFinite(now.getTime())) return "none";
  if (isHalloweenSeason(now)) return "halloween";
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  if (month === 11) return "autumn";
  if (month === 12 && day <= 10) return "winter";
  if (month === 12 && day <= 25) return "christmas";
  return "none";
}
