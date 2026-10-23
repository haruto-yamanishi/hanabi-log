import { getDatabase } from "../src/server/db/client";
import { getReportRepository } from "../src/server/repositories";
import { renderSlackReport, SlackWebApiAdapter } from "../src/server/integrations/slack";
import { prepareSlackAttachments } from "../src/server/integrations/slack-media";
import { createSlackVideoSync } from "../src/server/integrations/slack-videos";
import { isDemoMode } from "../src/server/env";
const sql = getDatabase();
try {
  if (isDemoMode) throw new Error("Run with DEMO_MODE=false");
  const apply = process.argv.includes("--apply");
  const repository = getReportRepository();
  const token = process.env.SLACK_BOT_TOKEN!;
  const sync = createSlackVideoSync(token);
  const api = SlackWebApiAdapter.fromToken(token);
  const bindings = await sql`select b.report_id,b.slack_channel_id,b.slack_message_ts from integration_bindings b join reports r on r.id=b.report_id
    where not b.slack_source_message and b.slack_message_ts is not null and r.status='published'
    and exists(select 1 from attachments a where a.report_id=r.id and a.mime_type like 'video/%')`;
  console.log(JSON.stringify({ reports: bindings.length, apply }));
  if (apply) {
    const response = await fetch("https://slack.com/api/auth.test", { headers: { Authorization: `Bearer ${token}` } });
    if (!response.headers.get("x-oauth-scopes")?.split(",").includes("files:write")) throw new Error("Slack files:write is required");
  }
  for (const binding of bindings) {
    const report = await repository.getReport(binding.report_id);
    if (!report) continue;
    console.log(JSON.stringify({ reportId: report.id, videos: report.attachments.filter(file=>file.mimeType.startsWith("video/")).length }));
    if (!apply) continue;
    await sync(report, binding.slack_channel_id, binding.slack_message_ts);
    const origin = process.env.APP_BASE_URL!;
    const prepared = await prepareSlackAttachments(report, origin);
    await api.updateMessage({ channel: binding.slack_channel_id, ts: binding.slack_message_ts, ...renderSlackReport(prepared, origin) });
  }
} finally { await sql.end(); }
