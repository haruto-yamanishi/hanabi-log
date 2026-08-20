import { RETRY_DELAYS_MS } from "@/lib/constants";
import type { DeliveryTarget, ReportStatus } from "@/lib/constants";
import type { MemberRole } from "@/lib/types";

const allowedTransitions: Record<ReportStatus, readonly ReportStatus[]> = {
  draft: ["published"],
  published: ["archived"],
  archived: ["published"],
};

export function canTransition(
  from: ReportStatus,
  to: ReportStatus,
  role: MemberRole,
): boolean {
  if (!allowedTransitions[from].includes(to)) return false;
  return !(from === "archived" && to === "published" && role !== "admin");
}

export function makeDedupeKey(
  reportId: string,
  target: DeliveryTarget,
  action: string,
  version: number,
): string {
  return `${reportId}:${target}:${action}:${version}`;
}

export function retryDelayMs(attempts: number): number | null {
  return RETRY_DELAYS_MS[attempts] ?? null;
}
