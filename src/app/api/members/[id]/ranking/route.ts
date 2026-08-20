import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { getReportRepository } from "@/server/repositories";

interface RouteContext { params: Promise<{ id: string }>; }

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    await requireCurrentUser();
    const memberId = (await context.params).id;
    const repository = getReportRepository();
    if (!await repository.getMember(memberId)) throw new AppError("NOT_FOUND", "メンバーが見つかりません", 404);
    return Response.json(await repository.getLogRanking(memberId), { headers: { "Cache-Control": "private, no-store" } });
  });
}
