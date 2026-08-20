import { z } from "zod";
import { apiResponse, reportId, reportResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
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
    return reportResponse(report, request);
  });
}
