import { apiResponse, reportId, reportResponse } from "@/app/api/_shared";
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
    scheduleReportJobs(id);
    return reportResponse(report, request);
  });
}
