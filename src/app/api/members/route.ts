import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { toPublicMember } from "@/server/members";
import { enforceRateLimit } from "@/server/rate-limit";
import { getReportRepository } from "@/server/repositories";

export async function GET(
  request: Request = new Request("http://localhost/api/members"),
): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    await enforceRateLimit(request, user.id, "read");
    const members = await getReportRepository().listMembers();
    return Response.json(members.map(toPublicMember), {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
