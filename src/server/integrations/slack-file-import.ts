import "server-only";
import { WebClient } from "@slack/web-api";
import { createClient } from "@supabase/supabase-js";
import { getDatabase } from "@/server/db/client";
import { env } from "@/server/env";
import { createSignedReadUrl } from "@/server/db/storage";
import type { ReportComment } from "@/lib/types";

export async function importSlackFile(reportId: string, fileId: string) {
  const sql = getDatabase();
  const [existing] = await sql`select * from slack_media_imports where report_id = ${reportId} and file_id = ${fileId}`;
  if (existing) return existing;
  const client = new WebClient(env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, timeout: 15000 });
  const { file } = await client.files.info({ file: fileId });
  if (!file?.url_private || !file.mimetype || !/^(image|video)\//.test(file.mimetype)) throw new Error("Slack media unavailable");
  const url = new URL(file.url_private);
  if (url.protocol !== "https:" || url.hostname !== "files.slack.com") throw new Error("Unexpected Slack file host");
  if ((file.size ?? 0) > 50_000_000) throw new Error("Slack file exceeds storage limit");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` }, redirect: "error", signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Slack file download failed: ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 50_000_000 || (file.size && bytes.length !== file.size)) throw new Error("Slack file size mismatch");
  const [report] = await sql`select author_id from reports where id = ${reportId}`;
  if (!report) throw new Error("Report missing");
  const storagePath = `${report.author_id}/slack/${reportId}/${fileId}`;
  const storage = createClient(env.SUPABASE_URL!, env.SUPABASE_SECRET_KEY!).storage.from(env.SUPABASE_STORAGE_BUCKET);
  for (let attempt = 0; ; attempt++) {
    const { error } = await storage.upload(storagePath, bytes, { contentType: file.mimetype, upsert: true });
    if (!error) break;
    if (attempt >= 2) throw new Error(`Slack media storage failed: ${error.message}`);
  }
  const [saved] = await sql`insert into slack_media_imports (report_id,file_id,storage_path,filename,mime_type,size_bytes)
    values (${reportId},${fileId},${storagePath},${file.name || fileId},${file.mimetype},${bytes.length})
    on conflict (report_id,file_id) do update set storage_path = excluded.storage_path returning *`;
  return saved;
}

export async function importCommentAttachments(reportId: string, comments: ReportComment[], origin: string, strict = true) {
  for (const comment of comments) {
    for (const file of comment.attachments ?? []) {
      try {
        const saved = await importSlackFile(reportId, file.id);
        file.url = await createSignedReadUrl(saved.storage_path, origin);
      } catch (error) {
        if (error instanceof Error && error.message === "Slack file exceeds storage limit" && file.mimeType.startsWith("video/")) {
          file.url = `/api/reports/${reportId}/comments/files/${file.id}`;
        } else if (strict) throw error;
      }
    }
  }
  return comments;
}
