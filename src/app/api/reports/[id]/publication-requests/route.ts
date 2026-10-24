import { after } from "next/server";
import { z } from "zod";
import { apiResponse, reportId, requestJson } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { enforceRateLimit } from "@/server/rate-limit";
import { createPublication, processPublicationNotifications } from "@/server/publication";
import { publicationCreateSchema } from "@/lib/publication";
export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{id:string}> }) {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    await enforceRateLimit(request,actor.id,"write");
    const id = reportId((await context.params).id);
    const input = publicationCreateSchema.parse(await requestJson(request));
    const key = z.uuid().parse(request.headers.get("idempotency-key") ?? crypto.randomUUID());
    const result = await createPublication(id,actor,input,key);
    after(async () => { try { await processPublicationNotifications(); } catch { console.error("Publication DM retained for retry"); } });
    return Response.json(result,{status:201,headers:{"Cache-Control":"private, no-store"}});
  });
}
