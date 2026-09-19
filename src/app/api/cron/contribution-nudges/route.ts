import { timingSafeEqual } from "node:crypto";
import { apiResponse } from "@/app/api/_shared";
import { env, isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { processContributionNudges } from "@/server/integrations/contribution-nudges";

function authorized(request: Request): boolean {
  if (isDemoMode && !env.CRON_SECRET) return true;
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    request.headers.get("x-cron-secret") ??
    "";
  const expected = env.CRON_SECRET ?? "";
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export async function POST(request: Request): Promise<Response> {
  return apiResponse(async () => {
    if (!authorized(request)) {
      throw new AppError("UNAUTHORIZED", "Cron認証に失敗しました", 401);
    }
    const result = await processContributionNudges();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}

export const GET = POST;
