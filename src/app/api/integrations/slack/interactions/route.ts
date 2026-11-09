import { env, isDemoMode } from "@/server/env";
import { verifySlackSignature } from "@/server/integrations/slack-incoming";
import { handlePublicationInteraction, interactionSchema } from "@/server/integrations/publication-interactions";

export const maxDuration = 60;
export async function POST(request: Request): Promise<Response> {
  if (isDemoMode || !env.SLACK_SIGNING_SECRET || !env.SLACK_TEAM_ID || !env.SLACK_BOT_TOKEN) return new Response(null, { status: 503 });
  const body = await request.text();
  if (!verifySlackSignature(body, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature"), env.SLACK_SIGNING_SECRET)) return new Response(null, { status: 401 });
  let payload;
  try { payload = interactionSchema.parse(JSON.parse(new URLSearchParams(body).get("payload") ?? "")); }
  catch { return new Response(null, { status: 400 }); }
  if (payload.team.id !== env.SLACK_TEAM_ID) return new Response(null, { status: 403 });
  return handlePublicationInteraction(payload);
}
