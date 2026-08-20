import { z } from "zod";
import { apiResponse, reportId, reportResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { processReportJobs } from "@/server/integrations/outbox";
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
    let report = await getReportRepository().requestIntegrationRetry(id, target, user);
    await processReportJobs(id);
    report = (await getReportRepository().getReadableReport(id, user)) ?? report;
    return reportResponse(report, request);
  });
}
