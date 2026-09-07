import {
  apiResponse,
  idempotencyKey,
  reportId,
  reportResponse,
} from "@/app/api/_shared";
import { recordAuditEvent } from "@/server/audit";
import { requireCurrentUser } from "@/server/auth";
import { scheduleReportJobs } from "@/server/integrations/schedule";
import { enforceRateLimit } from "@/server/rate-limit";
import { getReportRepository } from "@/server/repositories";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    await enforceRateLimit(request, user.id, "write");
    const id = reportId((await context.params).id);
    const report = await getReportRepository().publishReport(
      id,
      user,
      idempotencyKey(request),
    );
    await recordAuditEvent({
      actor: user,
      action: report.status === "published" ? "report.published" : "report.publish_requested",
      targetType: "report",
      targetId: id,
      after: { status: report.status, version: report.version },
    });
    if (report.status === "published") scheduleReportJobs(id);
    return reportResponse(report, request);
  });
}
