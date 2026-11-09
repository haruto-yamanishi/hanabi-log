import "server-only";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";
import { getReportRepository } from "@/server/repositories";
import { createSlackCommentService } from "@/server/integrations/slack-comments";
import { rememberComments } from "@/server/integrations/comment-likes";
import { importCommentAttachments } from "@/server/integrations/slack-file-import";

export async function syncCommentMedia() {
  if (isDemoMode || !env.SLACK_BOT_TOKEN) return;
  const sql = getDatabase();
  const rows = await sql`select b.report_id,b.slack_channel_id,b.slack_message_ts,b.comment_media_sync_requested_at from integration_bindings b
    join reports r on r.id=b.report_id where b.comment_media_sync_requested_at is not null and r.status in ('published','archived')
    order by b.comment_media_sync_requested_at limit 10`;
  if (!rows.length) return;
  const members = await getReportRepository().listMembers();
  const service = createSlackCommentService(env.SLACK_BOT_TOKEN);
  for (const row of rows) {
    try {
      const comments = await service.list({ channel: row.slack_channel_id, threadTs: row.slack_message_ts, members });
      await rememberComments(row.report_id, comments, true);
      await importCommentAttachments(row.report_id, comments, env.APP_BASE_URL ?? "http://localhost:3000", false);
      await sql`update integration_bindings set comment_media_sync_requested_at=null where report_id=${row.report_id}
        and comment_media_sync_requested_at=${row.comment_media_sync_requested_at}`;
    } catch {
      // Leave the request queued for cron retry; don't log private comment data.
      console.error("Comment media sync failed", { reportId: row.report_id });
    }
  }
}
