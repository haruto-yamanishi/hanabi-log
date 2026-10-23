import type { ReportSort } from "@/lib/types";
export { makeDedupeKey } from "@/lib/report-state";

export function encodeReportCursor(sortAt: string, id: string, sort: ReportSort = "newest", likeCount = 0): string {
  return Buffer.from(JSON.stringify({ sortAt, id, sort, likeCount }), "utf8").toString("base64url");
}

export function decodeReportCursor(cursor: string): { sortAt: string; id: string; sort: ReportSort; likeCount: number } | null {
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
      const sort = "sort" in value ? value.sort : "newest";
      const likeCount = "likeCount" in value ? value.likeCount : 0;
      if (sort !== "newest" && sort !== "oldest" && sort !== "popular") return null;
      if (typeof likeCount !== "number" || !Number.isSafeInteger(likeCount) || likeCount < 0) return null;
      return { sortAt: value.sortAt, id: value.id, sort, likeCount };
    }
  } catch {
    // Invalid cursors are handled by the caller as a validation error.
  }
  return null;
}
