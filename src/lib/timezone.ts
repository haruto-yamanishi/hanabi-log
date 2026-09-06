export const HANABI_TIME_ZONE = "Asia/Tokyo";

const reportDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: HANABI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Converts an instant to the Hanabi operating date using the IANA timezone
 * database instead of assuming Japan is permanently UTC+09:00.
 */
export function toHanabiReportDate(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error("Invalid date");

  const parts = reportDateFormatter.formatToParts(value);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) throw new Error("Unable to format Hanabi report date");
  return `${year}-${month}-${day}`;
}
