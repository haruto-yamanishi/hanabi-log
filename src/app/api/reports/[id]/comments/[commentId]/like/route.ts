import { apiResponse, notFound, reportId } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { getReportRepository } from "@/server/repositories";
import { enforceRateLimit } from "@/server/rate-limit";
import { setCommentLike } from "@/server/integrations/comment-likes";
import { scheduleLikeNotifications } from "@/server/integrations/like-notifications";

type Context = { params: Promise<{ id: string; commentId: string }> };
async function setLike(request: Request, context: Context, liked: boolean) {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    await enforceRateLimit(request, actor.id, "reaction");
    const params = await context.params;
    const id = reportId(params.id);
    if (!/^\d+\.\d+$/.test(params.commentId)) notFound();
    const report = await getReportRepository().getReadableReport(id, actor);
    if (!report) notFound();
    const result = await setCommentLike(id, params.commentId, actor, liked);
    if (liked) scheduleLikeNotifications();
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  });
}
export const PUT = (request: Request, context: Context) => setLike(request, context, true);
export const DELETE = (request: Request, context: Context) => setLike(request, context, false);
