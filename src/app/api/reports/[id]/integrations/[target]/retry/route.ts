import { z } from "zod";
import { apiResponse, reportId, reportResponse } from "@/app/api/_shared";
import { recordAuditEvent } from "@/server/audit";
import { requireCurrentUser } from "@/server/auth";
import { scheduleReportJobs } from "@/server/integrations/schedule";
import { getReportRepository } from "@/server/repositories";

interface RouteContext {
  params: Promise<{ id: string; target: string }>;
}

const targetSchema = z.enum(["slack", "notion"]);

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const parameters = await context.params;
    const id = reportId(parameters.id);
    const target = targetSchema.parse(parameters.target);
    const report = await getReportRepository().requestIntegrationRetry(id, target, user);
    await recordAuditEvent({
      actor: user,
      action: "integration.retry_requested",
      targetType: "report_integration",
      targetId: `${id}:${target}`,
      metadata: { reportId: id, integrationTarget: target },
    });
    scheduleReportJobs(id);
    return reportResponse(report, request);
  });
}
