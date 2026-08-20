import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { getReportRepository } from "@/server/repositories";

export async function GET(): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const to = new Date();
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - 365);
    const summary = await getReportRepository().getContributionSummary(user.id, from, to);
    return Response.json(summary, { headers: { "Cache-Control": "private, no-store" } });
  });
}
