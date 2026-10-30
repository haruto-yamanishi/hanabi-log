import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { enforceRateLimit } from "@/server/rate-limit";
import { getUsageAnalytics } from "@/server/analytics";
import { AppError } from "@/server/errors";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    if (user.role !== "admin") throw new AppError("FORBIDDEN", "管理者のみ閲覧できます", 403);
    await enforceRateLimit(request, user.id, "read");
    return Response.json(await getUsageAnalytics(user), { headers: { "Cache-Control": "private, no-store" } });
  });
}
