import { timingSafeEqual } from "node:crypto";
import { apiResponse } from "@/app/api/_shared";
import { env, isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { SlackWebApiAdapter } from "@/server/integrations/slack";
import { deliverWeeklyDigest } from "@/server/integrations/weekly-digest";
import { getReportRepository } from "@/server/repositories";

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
    if (!authorized(request)) throw new AppError("UNAUTHORIZED", "Cron認証に失敗しました", 401);
    if (!env.SLACK_BOT_TOKEN || !env.SLACK_RANDOM_CHANNEL_ID || !env.APP_BASE_URL) {
      return Response.json(
        { status: "skipped", reason: "weekly_digest_not_configured" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const result = await deliverWeeklyDigest({
      repository: getReportRepository(),
      slack: SlackWebApiAdapter.fromToken(env.SLACK_BOT_TOKEN),
      tokenChannelId: env.SLACK_RANDOM_CHANNEL_ID,
      appBaseUrl: env.APP_BASE_URL,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  });
}

export const GET = POST;
