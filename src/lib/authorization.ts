import type { CurrentUser, Report } from "@/lib/types";

export function canReadReport(user: CurrentUser, report: Report): boolean {
  return (
    report.status === "published" ||
    report.authorId === user.id ||
    user.role === "admin"
  );
}

export function canEditReport(user: CurrentUser, report: Report): boolean {
  return report.authorId === user.id || user.role === "admin";
}

export function canRestoreReport(user: CurrentUser, report: Report): boolean {
  return user.role === "admin" && report.status === "archived";
}

export function requireAdmin(user: CurrentUser): void {
  if (user.role !== "admin") throw new Error("FORBIDDEN");
}
