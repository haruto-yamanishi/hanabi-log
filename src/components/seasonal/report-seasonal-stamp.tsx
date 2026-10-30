import type { ComponentType } from "react";
import { seasonalEventForDate, type SeasonalEvent } from "@/lib/seasonal-events";
import { HalloweenComposition } from "./halloween-composition";

function HalloweenStamp() { return <HalloweenComposition variant="header" />; }
// Adding an event requires its artwork here; the type checker catches omissions.
const stampArtwork: Record<SeasonalEvent["id"], ComponentType> = {
  halloween: HalloweenStamp,
};

export function ReportSeasonalStamp({ reportDate }: { reportDate: string }) {
  const event = seasonalEventForDate(reportDate);
  if (!event) return null;
  const Artwork = stampArtwork[event.id];
  return <div className="report-seasonal-stamp" data-seasonal-stamp={event.id} role="img" aria-label={`${event.label}期間の日報`}>
    <Artwork />
  </div>;
}
