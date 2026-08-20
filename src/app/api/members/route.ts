import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { toPublicMember } from "@/server/members";
import { getReportRepository } from "@/server/repositories";

export async function GET(): Promise<Response> {
  return apiResponse(async () => {
    await requireCurrentUser();
    const members = await getReportRepository().listMembers();
    return Response.json(members.map(toPublicMember), {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
