import { after } from "next/server";
import { env, isDemoMode } from "@/server/env";
import { getDatabase } from "@/server/db/client";
import { incomingSlackMessage, incomingSlackReaction, verifySlackSignature } from "@/server/integrations/slack-incoming";
import { processIncomingSlackReports } from "@/server/integrations/slack-incoming-store";
import { processPendingJobs } from "@/server/integrations/outbox";
import { processLikeNotifications } from "@/server/integrations/like-notifications";

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
  const reaction = payload.type === "event_callback" ? incomingSlackReaction(payload.event, env.SLACK_CHANNEL_ID) : null;
  if (message || reaction) {
    const sql = getDatabase();
    if (message) {
      await sql`insert into slack_incoming_reports (channel_id, message_ts, user_id, body, event_ts)
        values (${message.channel}, ${message.ts}, ${message.user}, ${message.text}, ${message.eventTs})
        on conflict (channel_id, message_ts) do update set
          body = excluded.body,
          event_ts = excluded.event_ts,
          processed_at = null,
          attempts = 0,
          available_at = now(),
          last_error = null,
          dead_at = null
        where slack_incoming_reports.event_ts < excluded.event_ts
          and slack_incoming_reports.user_id = excluded.user_id`;
    }
    if (reaction) {
      await sql`insert into slack_report_reactions (channel_id, message_ts, user_id, reaction, active, event_ts)
        values (${reaction.item.channel}, ${reaction.item.ts}, ${reaction.user}, ${reaction.reaction}, ${reaction.type === "reaction_added"}, ${reaction.event_ts})
        on conflict (channel_id, message_ts, user_id, reaction) do update set
          active = excluded.active,
          event_ts = excluded.event_ts,
          processed_at = null,
          attempts = 0,
          available_at = now(),
          last_error = null,
          dead_at = null
        where slack_report_reactions.event_ts < excluded.event_ts`;
    }
    after(async () => {
      try {
        await processIncomingSlackReports();
        await processLikeNotifications();
        await processPendingJobs();
      } catch { console.error("Deferred Slack import failed; retained for cron retry"); }
    });
  }
  return Response.json({ ok: true });
}
