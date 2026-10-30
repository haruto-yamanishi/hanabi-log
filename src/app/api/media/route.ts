import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { enforceRateLimit } from "@/server/rate-limit";
import { listMedia, mediaFilters } from "@/server/media-gallery";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    await enforceRateLimit(request, actor.id, "read");
    const filters = mediaFilters.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await listMedia(filters, actor), { headers: { "Cache-Control": "private, no-store" } });
  });
}
