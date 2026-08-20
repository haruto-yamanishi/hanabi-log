import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { toPublicMember } from "@/server/members";
import { getReportRepository } from "@/server/repositories";

export async function GET(): Promise<Response> {
  return apiResponse(async () => {
    await requireCurrentUser();
    const rankings = await getReportRepository().listLogRankings();
    return Response.json(rankings.map(({ member, ranking }) => ({ member: toPublicMember(member), ranking })), { headers: { "Cache-Control": "private, no-store" } });
  });
}
