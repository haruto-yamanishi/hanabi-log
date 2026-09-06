import { after } from "next/server";
import { env, isDemoMode } from "@/server/env";
import { getDatabase } from "@/server/db/client";
import { incomingSlackMessage, verifySlackSignature } from "@/server/integrations/slack-incoming";
import { processIncomingSlackReports } from "@/server/integrations/slack-incoming-store";
import { processPendingJobs } from "@/server/integrations/outbox";

export async function POST(request: Request): Promise<Response> {
  if (isDemoMode || !env.SLACK_SIGNING_SECRET || !env.SLACK_TEAM_ID || !env.SLACK_CHANNEL_ID) return new Response(null, { status: 503 });
  const body = await request.text();
  if (!verifySlackSignature(body, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature"), env.SLACK_SIGNING_SECRET)) return new Response(null, { status: 401 });
  let payload;
  try { payload = JSON.parse(body); } catch { return new Response(null, { status: 400 }); }
  if (!payload || typeof payload !== "object") return new Response(null, { status: 400 });
  if (payload.type === "url_verification" && typeof payload.challenge === "string") return Response.json({ challenge: payload.challenge });
  if (payload.team_id !== env.SLACK_TEAM_ID) return new Response(null, { status: 403 });
  const message = payload.type === "event_callback" ? incomingSlackMessage(payload.event, env.SLACK_CHANNEL_ID) : null;
  if (message) {
    const sql = getDatabase();
    await sql`insert into slack_incoming_reports (channel_id, message_ts, user_id, body)
      values (${message.channel}, ${message.ts}, ${message.user}, ${message.text}) on conflict do nothing`;
    after(async () => {
      try {
        await processIncomingSlackReports();
        await processPendingJobs();
      } catch { console.error("Deferred Slack import failed; retained for cron retry"); }
    });
  }
  return Response.json({ ok: true });
}
