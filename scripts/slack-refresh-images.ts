import { getDatabase } from "../src/server/db/client";
import { getReportRepository } from "../src/server/repositories";
import { renderSlackReport, SlackWebApiAdapter } from "../src/server/integrations/slack";
import { prepareSlackAttachments } from "../src/server/integrations/slack-media";
import { isDemoMode } from "../src/server/env";
const sql = getDatabase();
try {
  if (isDemoMode) throw new Error("Run with DEMO_MODE=false");
  const repository = getReportRepository();
  const api = SlackWebApiAdapter.fromToken(process.env.SLACK_BOT_TOKEN!);
  const bindings = await sql`select report_id,slack_channel_id,slack_message_ts from integration_bindings
    where not slack_source_message and slack_message_ts is not null and report_id in
      (select report_id from attachments)`;
  let updated = 0;
  for (const binding of bindings) {
    const only = process.argv.find(arg => arg.startsWith("--report="))?.slice(9);
    if (only && binding.report_id !== only) continue;
    const report = await repository.getReport(binding.report_id);
    if (!report || report.status !== "published") continue;
    const prepared = await prepareSlackAttachments(report, process.env.APP_BASE_URL!);
    for (const attachment of prepared.attachments.filter(file => file.mimeType.startsWith("image/"))) {
      if (!attachment.signedUrl) throw new Error("Missing image URL");
      const response = await fetch(attachment.signedUrl);
      await response.body?.cancel();
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) throw new Error(`Image endpoint failed: ${response.status}`);
    }
    await api.updateMessage({ channel: binding.slack_channel_id, ts: binding.slack_message_ts, ...renderSlackReport(prepared, process.env.APP_BASE_URL!) });
    updated++;
    console.log(JSON.stringify({ updated, total: bindings.length }));
  }
} finally { await sql.end(); }
