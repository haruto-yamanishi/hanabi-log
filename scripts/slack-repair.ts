/** Run with node --env-file=.env.local --conditions=react-server --import tsx scripts/slack-repair.ts [--apply] */
import { readFile, writeFile } from "node:fs/promises";
import { WebClient } from "@slack/web-api";
import { isDemoMode } from "../src/server/env";
import { getDatabase } from "../src/server/db/client";
import { incomingSlackMessage } from "../src/server/integrations/slack-incoming";
import { processIncomingSlackReports } from "../src/server/integrations/slack-incoming-store";
import { createSlackCommentService } from "../src/server/integrations/slack-comments";
import { rememberComments } from "../src/server/integrations/comment-likes";
import { importCommentAttachments } from "../src/server/integrations/slack-file-import";
import { importPastSlackReactions } from "../src/server/integrations/slack-reaction-backfill";
import { getReportRepository } from "../src/server/repositories";
import { createSlackIntegration } from "../src/server/integrations/slack";
import { prepareSlackAttachments } from "../src/server/integrations/slack-media";

const sql = getDatabase();
const channel = process.env.SLACK_CHANNEL_ID!;
const token = process.env.SLACK_BOT_TOKEN!;
const apply = process.argv.includes("--apply");
const commentsOnly = process.argv.includes("--comments-only");
try {
  if (isDemoMode) throw new Error("Run with DEMO_MODE=false");
  const historyPath = process.argv.find(arg => arg.startsWith("--history="))?.slice(10);
  const messages = historyPath ? JSON.parse(await readFile(historyPath, "utf8")) : [];
  if (!historyPath) {
    const client = new WebClient(token, { retryConfig: { retries: 0 }, timeout: 15000 });
    let cursor: string | undefined;
    do {
      const page = await client.conversations.history({ channel, cursor, limit: 100 });
      messages.push(...page.messages ?? []);
      cursor = page.response_metadata?.next_cursor || undefined;
      if (page.has_more && !cursor) throw new Error("Incomplete channel history");
    } while (cursor);
  }
  const incoming = messages.map((message: Record<string, unknown>) => incomingSlackMessage({ ...message, type: "message", channel }, channel)).filter(Boolean);
  console.log(JSON.stringify({ candidates: incoming.length, apply }));
  if (apply) {
    // Private local recovery snapshot. This is never written into the repository.
    await writeFile(`/tmp/hanabi-before-repair-${Date.now()}.json`, JSON.stringify({
      reports: await sql`select * from reports`, bindings: await sql`select * from integration_bindings`,
      attachments: await sql`select * from attachments`, likes: await sql`select * from report_likes`,
    }), { mode: 0o600 });
    for (const message of process.argv.includes("--skip-queue") || commentsOnly ? [] : incoming) {
      const [binding] = await sql`select report_id from integration_bindings where slack_channel_id=${channel} and slack_message_ts=${message.ts}`;
      const files = (message.files ?? []).filter((file: { mimetype?: string }) => /^(image|video)\//.test(file.mimetype ?? "")).map((file: { id: string }) => file.id);
      await sql`insert into slack_incoming_reports (channel_id,message_ts,user_id,body,event_ts,file_ids,report_id,imported,processed_at,historical)
        values (${channel},${message.ts},${message.user},${message.text},${message.eventTs},${sql.json(files)},${binding?.report_id ?? null},${Boolean(binding)},${binding ? new Date() : null},true)
        on conflict (channel_id,message_ts) do update set file_ids=excluded.file_ids, historical=true,
          media_imported_at=case when slack_incoming_reports.file_ids=excluded.file_ids then slack_incoming_reports.media_imported_at else null end`;
    }
    for (let round = 0; round < (commentsOnly ? 0 : 20); round++) {
      await processIncomingSlackReports();
      const [pending] = await sql`select count(*)::int as count from slack_incoming_reports where processed_at is null`;
      console.log(JSON.stringify({ phase: "reports", pending: pending.count }));
      if (!pending.count) break;
    }
    const repository = getReportRepository();
    const members = await repository.listMembers();
    const bindings = await sql`select report_id,slack_message_ts from integration_bindings where slack_channel_id=${channel} and slack_message_ts is not null order by slack_message_ts`;
    let comments = 0;
    const errors: { reportId: string; phase: string; message: string }[] = [];
    for (const binding of bindings) {
      try {
        const replies = await createSlackCommentService(token).list({ channel, threadTs: binding.slack_message_ts, members });
        await rememberComments(binding.report_id, replies);
        await importCommentAttachments(binding.report_id, replies, process.env.APP_BASE_URL!);
        comments += replies.length;
      } catch (error) { errors.push({ reportId: binding.report_id, phase: "comments", message: error instanceof Error ? error.message : "failed" }); }
    }
    console.log(JSON.stringify({ phase: "comments", comments, errors }));
    for (let round = 0; round < (commentsOnly ? 0 : 500); round++) {
      const result = await importPastSlackReactions();
      if (round % 10 === 0 || !result.remaining) console.log(JSON.stringify({ phase: "reactions", ...result }));
      if (!result.remaining && !result.pending) break;
    }
    if (process.argv.includes("--repair-messages")) {
      const integration = createSlackIntegration({ token, channelId: channel, appBaseUrl: process.env.APP_BASE_URL!, prepareReport: report => prepareSlackAttachments(report, process.env.APP_BASE_URL!) });
      for (const binding of bindings) {
        const report = await repository.getReport(binding.report_id);
        if (!report || report.integration?.slackSourceMessage || report.status !== "published") continue;
        await integration.sync(report, report.integration ?? null);
      }
      console.log(JSON.stringify({ phase: "slack-images", done: true }));
    }
    if (errors.length) process.exitCode = 1;
  }
} finally { await sql.end(); }
