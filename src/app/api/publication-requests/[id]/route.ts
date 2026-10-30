import { after } from "next/server";
import { apiResponse, reportId, requestJson } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { enforceRateLimit } from "@/server/rate-limit";
import { getPublication, actOnPublication, processPublicationNotifications } from "@/server/publication";
import { publicationActionSchema } from "@/lib/publication";
export const maxDuration = 300;
type Context = {params:Promise<{id:string}>};
export async function GET(request:Request,context:Context) {
  return apiResponse(async () => {
    const actor = await requireCurrentUser(); await enforceRateLimit(request,actor.id,"read");
    return Response.json(await getPublication(reportId((await context.params).id),actor),{headers:{"Cache-Control":"private, no-store"}});
  });
}
export async function POST(request:Request,context:Context) {
  return apiResponse(async () => {
    const actor = await requireCurrentUser(); await enforceRateLimit(request,actor.id,"write");
    const action = publicationActionSchema.parse(await requestJson(request));
    const result = await actOnPublication(reportId((await context.params).id),actor,action);
    after(async () => { try { await processPublicationNotifications(); } catch { console.error("Publication DM retained for retry"); } });
    return Response.json(result,{headers:{"Cache-Control":"private, no-store"}});
  });
}
