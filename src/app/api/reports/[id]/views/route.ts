import { z } from "zod";
import { apiResponse, notFound, reportId, requestJson } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { enforceRateLimit } from "@/server/rate-limit";
import { recordReportView } from "@/server/analytics";
import { getReportRepository } from "@/server/repositories";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    await enforceRateLimit(request, user.id, "read");
    const id = reportId((await context.params).id);
    const { visitId } = z.object({ visitId: z.uuid() }).parse(await requestJson(request));
    const report = await getReportRepository().getReadableReport(id, user);
    if (!report) notFound();
    if (report.status === "published" || report.status === "archived") await recordReportView(id, user.id, visitId);
    return new Response(null, { status: 204 });
  });
}
