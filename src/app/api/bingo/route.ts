import { z } from "zod";
import { apiResponse, requestJson } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { getBingoSnapshot, actOnBingo } from "@/server/bingo-game";
import { AppError } from "@/server/errors";
import { env } from "@/server/env";
import { enforceRateLimit } from "@/server/rate-limit";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), rule: z.enum(["uniform", "report-support"]) }).strict(),
  z.object({ action: z.literal("draw"), expectedSequence: z.number().int().min(0).max(75), requestId: z.uuid() }).strict(),
  z.object({ action: z.literal("finish"), expectedSequence: z.number().int().min(0).max(75) }).strict(),
]);
export async function GET() {
  return apiResponse(async () => Response.json(await getBingoSnapshot(await requireCurrentUser()), { headers: { "Cache-Control": "private, no-store" } }));
}
export async function POST(request: Request) {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const origin = request.headers.get("origin");
    const allowedOrigins = new Set([new URL(request.url).origin, ...(env.APP_BASE_URL ? [new URL(env.APP_BASE_URL).origin] : [])]);
    if (!origin || !allowedOrigins.has(origin)) throw new AppError("FORBIDDEN_ORIGIN", "この画面から操作してください", 403);
    await enforceRateLimit(request, user.id, "admin");
    const action = actionSchema.parse(await requestJson(request));
    return Response.json(await actOnBingo(user, action), { headers: { "Cache-Control": "private, no-store" } });
  });
}
