import { apiResponse, reportId } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { enforceRateLimit } from "@/server/rate-limit";
import { getReportRepository } from "@/server/repositories";

import { scheduleLikeNotifications } from "@/server/integrations/like-notifications";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function setLike(request: Request, context: RouteContext, liked: boolean): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    await enforceRateLimit(request, user.id, "reaction");
    const id = reportId((await context.params).id);
    const result = await getReportRepository().setReportLike(id, user, liked);
    if (liked) scheduleLikeNotifications();
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  return setLike(request, context, true);
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  return setLike(request, context, false);
}
