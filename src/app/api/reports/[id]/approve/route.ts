import { apiResponse, reportId, reportResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { getReportRepository } from "@/server/repositories";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    const id = reportId((await context.params).id);
    const repository = getReportRepository();
    const report = await repository.approveReport(id, actor);
    return reportResponse(report, request);
  });
}
