import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { enforceRateLimit } from "@/server/rate-limit";
import { recordPresence } from "@/server/analytics";
export async function POST(request: Request) {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    await enforceRateLimit(request, user.id, "read");
    await recordPresence(user.id);
    return new Response(null, { status: 204 });
  });
}
