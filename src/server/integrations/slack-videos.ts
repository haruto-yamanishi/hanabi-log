import "server-only";
import { createHash } from "node:crypto";
import { WebClient } from "@slack/web-api";
import type { Report } from "@/lib/types";
import { isVideoMimeType } from "@/lib/media";
import { getDatabase } from "@/server/db/client";
import { readStoredUpload } from "@/server/db/storage";
import { IntegrationError } from "./errors";

export const VIDEO_COMMENT = "日報の添付動画（Hanabi Log）";
function fail(code: string): never { throw new IntegrationError(code, { retryable: true }); }
function apiCode(error: unknown): string | undefined { return (error as { data?: { error?: string } })?.data?.error; }

export function createSlackVideoSync(token: string) {
  const client = new WebClient(token, { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 30_000 });
  return async (report: Report, channel: string, threadTs: string) => {
    const sql = getDatabase();
    const videos = report.status === "published" ? report.attachments.filter(file => isVideoMimeType(file.mimeType)) : [];
    const wanted = new Set(videos.map(file => file.storagePath));
    const old = await sql`select * from slack_video_uploads where report_id = ${report.id}`;
    // Delete only files created by this integration, never original Slack files.
    for (const row of old) {
      if (wanted.has(row.storage_path) && row.channel_id === channel && row.thread_ts === threadTs) continue;
      const [claimed] = await sql`update slack_video_uploads set lease_until = now() + interval '10 minutes'
        where report_id = ${report.id} and storage_path = ${row.storage_path} and (lease_until is null or lease_until < now()) returning file_id`;
      if (!claimed) fail("SLACK_VIDEO_BUSY");
      try {
        if (claimed.file_id) {
          try { await client.files.delete({ file: claimed.file_id }); }
          catch (error) { if (!["file_not_found", "file_deleted"].includes(apiCode(error) ?? "")) throw error; }
        }
        await sql`delete from slack_video_uploads where report_id = ${report.id} and storage_path = ${row.storage_path}`;
      } finally {
        await sql`update slack_video_uploads set lease_until = null where report_id = ${report.id} and storage_path = ${row.storage_path}`;
      }
    }
    for (const attachment of videos) {
      await sql`insert into slack_video_uploads (report_id,storage_path,channel_id,thread_ts)
        values (${report.id},${attachment.storagePath},${channel},${threadTs}) on conflict do nothing`;
      const [row] = await sql`update slack_video_uploads set lease_until = now() + interval '10 minutes'
        where report_id = ${report.id} and storage_path = ${attachment.storagePath} and (lease_until is null or lease_until < now()) returning *`;
      if (!row) fail("SLACK_VIDEO_BUSY");
      try {
        if (row.shared) continue;
        let fileId: string | undefined = row.file_id;
        let uploadUrl: string | undefined = row.upload_url;
        let uploaded: boolean = row.uploaded;
        // Keep the file ID before uploading or sharing. A lost completion response
        // must retry the same file instead of posting a second copy.
        if (!fileId || !uploaded) {
          const { bytes } = await readStoredUpload(attachment.storagePath);
          if (!fileId) {
            const suffix = attachment.mimeType === "video/quicktime" ? "mov" : attachment.mimeType === "video/webm" ? "webm" : "mp4";
            const key = createHash("sha256").update(attachment.storagePath).digest("hex").slice(0, 16);
            const result = await client.files.getUploadURLExternal({ filename: `hanabi-log-${report.id}-${key}.${suffix}`, length: bytes.byteLength });
            if (!result.file_id || !result.upload_url) fail("SLACK_VIDEO_UPLOAD_URL_MISSING");
            fileId = result.file_id; uploadUrl = result.upload_url;
            await sql`update slack_video_uploads set file_id=${fileId},upload_url=${uploadUrl},updated_at=now() where report_id=${report.id} and storage_path=${attachment.storagePath}`;
          }
          if (!uploadUrl) fail("SLACK_VIDEO_UPLOAD_URL_MISSING");
          const url = new URL(uploadUrl);
          if (url.protocol !== "https:" || url.hostname !== "files.slack.com") fail("SLACK_VIDEO_UPLOAD_URL_INVALID");
          const response = await fetch(url, { method: "POST", body: Buffer.from(bytes), headers: { "Content-Type": "application/octet-stream" }, redirect: "error", signal: AbortSignal.timeout(120_000) });
          if (!response.ok) fail("SLACK_VIDEO_UPLOAD_FAILED");
          await response.arrayBuffer();
          await sql`update slack_video_uploads set uploaded=true,upload_url=null,updated_at=now() where report_id=${report.id} and storage_path=${attachment.storagePath}`;
          uploaded = true;
        }
        if (!fileId || !uploaded) fail("SLACK_VIDEO_UPLOAD_INCOMPLETE");
        // After a timeout Slack may already have shared the file. Check shares first.
        let shared = false;
        try {
          const info = await client.files.info({ file: fileId });
          const shares = [...(info.file?.shares?.public?.[channel] ?? []), ...(info.file?.shares?.private?.[channel] ?? [])];
          shared = shares.some(share => share.thread_ts === threadTs);
        } catch (error) { if (!["file_not_found", "file_deleted"].includes(apiCode(error) ?? "")) throw error; }
        if (!shared) await client.files.completeUploadExternal({ files: [{ id: fileId, title: attachment.filename }], channel_id: channel, thread_ts: threadTs, initial_comment: VIDEO_COMMENT });
        await sql`update slack_video_uploads set shared=true,upload_url=null,updated_at=now() where report_id=${report.id} and storage_path=${attachment.storagePath}`;
      } finally {
        await sql`update slack_video_uploads set lease_until=null where report_id=${report.id} and storage_path=${attachment.storagePath}`;
      }
    }
  };
}
