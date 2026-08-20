export { makeDedupeKey } from "@/lib/report-state";

export function encodeReportCursor(sortAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ sortAt, id }), "utf8").toString("base64url");
}

export function decodeReportCursor(cursor: string): { sortAt: string; id: string } | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof value === "object" &&
      value !== null &&
      "sortAt" in value &&
      typeof value.sortAt === "string" &&
      !Number.isNaN(Date.parse(value.sortAt)) &&
      "id" in value &&
      typeof value.id === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
    ) {
      return { sortAt: value.sortAt, id: value.id };
    }
  } catch {
    // Invalid cursors are handled by the caller as a validation error.
  }
  return null;
}
