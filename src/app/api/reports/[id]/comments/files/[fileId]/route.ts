import { WebClient } from "@slack/web-api";
import { apiResponse, notFound, reportId } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { env } from "@/server/env";
import { getReportRepository } from "@/server/repositories";
import { SlackWebCommentAdapter } from "@/server/integrations/slack-comments";
import { enforceRateLimit } from "@/server/rate-limit";

export const maxDuration = 300;

// Large Slack videos can stream without buffering them into the application or
// making the private Slack download URL/token available to the browser.
export async function GET(request: Request, context: { params: Promise<{ id: string; fileId: string }> }) {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    await enforceRateLimit(request, actor.id, "read");
    const params = await context.params;
    if (!/^F[A-Z0-9]+$/.test(params.fileId)) notFound();
    const report = await getReportRepository().getReadableReport(reportId(params.id), actor);
    const binding = report?.integration;
    if (!binding?.slackChannelId || !binding.slackMessageTs || !env.SLACK_BOT_TOKEN) notFound();
    const replies = await SlackWebCommentAdapter.fromToken(env.SLACK_BOT_TOKEN).listReplies({ channel: binding.slackChannelId, threadTs: binding.slackMessageTs });
    if (!replies.some(reply => reply.files?.some(file => file.id === params.fileId))) notFound();
    const client = new WebClient(env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, timeout: 10000 });
    const { file } = await client.files.info({ file: params.fileId });
    if (!file?.url_private || !file.mimetype?.startsWith("video/")) notFound();
    const url = new URL(file.url_private);
    if (url.protocol !== "https:" || url.hostname !== "files.slack.com") notFound();
    const headers: Record<string, string> = { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` };
    const range = request.headers.get("range");
    if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
    const response = await fetch(url, { headers, redirect: "error", signal: AbortSignal.timeout(240000) });
    if (!response.ok) return new Response(null, { status: response.status === 416 ? 416 : 502 });
    const resultHeaders = new Headers({ "Content-Type": file.mimetype, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-length", "content-range", "accept-ranges"]) {
      const value = response.headers.get(name);
      if (value) resultHeaders.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: resultHeaders });
  });
}
