// Read Slack threads to reconstruct attachment associations, without posting messages.
// Run with DEMO_MODE=false and --apply after migration 202610230006.
import { getDatabase } from "../src/server/db/client";
import { getReportRepository } from "../src/server/repositories";
import { createSlackCommentService } from "../src/server/integrations/slack-comments";
import { rememberComments } from "../src/server/integrations/comment-likes";
import { env, isDemoMode } from "../src/server/env";
if (isDemoMode || !env.SLACK_BOT_TOKEN) throw new Error("Live Slack configuration required");
const sql = getDatabase();
try {
  const rows = await sql`select b.report_id,b.slack_channel_id,b.slack_message_ts from integration_bindings b join reports r on r.id=b.report_id
    where r.status in ('published','archived') and b.slack_message_ts is not null order by r.report_date desc`;
  if (!process.argv.includes("--apply")) { console.log({ threads: rows.length, dryRun: true }); }
  else {
    const members = await getReportRepository().listMembers();
    const service = createSlackCommentService(env.SLACK_BOT_TOKEN);
    let files = 0, processed = 0, failed = 0;
    for (const row of rows) {
      try {
        const comments = await service.list({ channel: row.slack_channel_id, threadTs: row.slack_message_ts, members });
        await rememberComments(row.report_id, comments, true);
        files += comments.reduce((sum, comment) => sum + (comment.attachments?.length ?? 0), 0);
        processed++;
      } catch { failed++; console.error("Thread unavailable", { reportId: row.report_id }); }
      if ((processed + failed) % 20 === 0) console.log({ processed, files, failed });
    }
    console.log({ processed, files, failed });
  }
} finally { await sql.end(); }
