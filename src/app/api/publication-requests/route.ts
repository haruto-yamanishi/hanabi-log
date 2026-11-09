import { apiResponse, reportId } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { enforceRateLimit } from "@/server/rate-limit";
import { listPublications } from "@/server/publication";
export async function GET(request: Request) {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    await enforceRateLimit(request,actor.id,"read");
    const id = new URL(request.url).searchParams.get("reportId");
    return Response.json(await listPublications(actor,id ? reportId(id) : undefined),{headers:{"Cache-Control":"private, no-store"}});
  });
}
