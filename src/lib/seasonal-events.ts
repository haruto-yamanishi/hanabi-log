/** Recurring calendar events. Dates are inclusive, in MM-DD form. */
export const SEASONAL_EVENTS = [
  { id: "halloween", label: "ハロウィン", startsOn: "10-20", endsOn: "10-31" },
] as const;
export type SeasonalEvent = (typeof SEASONAL_EVENTS)[number];

/** A report's date is a calendar date, not a publication timestamp. */
export function seasonalEventForDate(date: string): SeasonalEvent | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return undefined;
  const day = date.slice(5);
  return SEASONAL_EVENTS.find(event => {
    const start: string = event.startsOn;
    const end: string = event.endsOn;
    return start <= end ? day >= start && day <= end : day >= start || day <= end;
  });
}
