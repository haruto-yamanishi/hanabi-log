import { apiResponse, reportId, reportResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { getReportRepository } from "@/server/repositories";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const id = reportId((await context.params).id);
    const report = await getReportRepository().restoreReport(id, user);
    return reportResponse(report, request);
  });
}
