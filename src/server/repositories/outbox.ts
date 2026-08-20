export { makeDedupeKey } from "@/lib/report-state";

export function encodeReportCursor(reportDate: string, id: string): string {
  return Buffer.from(JSON.stringify({ reportDate, id }), "utf8").toString("base64url");
}

export function decodeReportCursor(cursor: string): { reportDate: string; id: string } | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "reportDate" in value &&
      typeof value.reportDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value.reportDate) &&
      "id" in value &&
      typeof value.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
    ) {
      return { reportDate: value.reportDate, id: value.id };
    }
  } catch {
    // Invalid cursors are handled by the caller as a validation error.
  }
  return null;
}
