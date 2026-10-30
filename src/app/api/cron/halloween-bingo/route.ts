import { timingSafeEqual } from "node:crypto";
import { apiResponse } from "@/app/api/_shared";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { processBingoNotifications } from "@/server/integrations/halloween-bingo";
export const maxDuration = 300;
export async function GET(request: Request) {
  return apiResponse(async () => {
    const expected = Buffer.from(env.CRON_SECRET ?? "");
    const supplied = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
    if (!expected.length || expected.length !== supplied.length || !timingSafeEqual(expected,supplied))
      throw new AppError("UNAUTHORIZED", "Cron認証に失敗しました",401);
    await processBingoNotifications();
    return Response.json({ok:true});
  });
}
