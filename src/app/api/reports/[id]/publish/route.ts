import {
  apiResponse,
  idempotencyKey,
  reportId,
  reportResponse,
} from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { processReportJobs } from "@/server/integrations/outbox";
import { getReportRepository } from "@/server/repositories";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const id = reportId((await context.params).id);
    let report = await getReportRepository().publishReport(
      id,
      user,
      idempotencyKey(request),
    );
    await processReportJobs(id);
    report = (await getReportRepository().getReadableReport(id, user)) ?? report;
    return reportResponse(report, request);
  });
}
