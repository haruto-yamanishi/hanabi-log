import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { importPastSlackReactions } from "@/server/integrations/slack-reaction-backfill";
import { scheduleLikeNotifications } from "@/server/integrations/like-notifications";

export const maxDuration = 60;

export async function POST(): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    if (user.role !== "admin") throw new AppError("FORBIDDEN", "管理者だけが取り込めます", 403);
    const result = await importPastSlackReactions();
    scheduleLikeNotifications();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}
