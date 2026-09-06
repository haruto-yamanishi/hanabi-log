import { apiResponse, reportId, reportResponse } from "@/app/api/_shared";
import { recordAuditEvent } from "@/server/audit";
import { requireCurrentUser } from "@/server/auth";
import { scheduleReportJobs } from "@/server/integrations/schedule";
import { getReportRepository } from "@/server/repositories";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const id = reportId((await context.params).id);
    const report = await getReportRepository().archiveReport(id, user);
    await recordAuditEvent({
      actor: user,
      action: "report.archived",
      targetType: "report",
      targetId: id,
      after: { status: report.status, version: report.version },
    });
    scheduleReportJobs(id);
    return reportResponse(report, request);
  });
}
