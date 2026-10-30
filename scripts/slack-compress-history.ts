/** Imports oversized historical videos as H.264/AAC copies; original Slack files remain untouched. */
import { WebClient } from "@slack/web-api";
import { createClient } from "@supabase/supabase-js";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase } from "../src/server/db/client";
const run = promisify(execFile);
const sql = getDatabase();
const client = new WebClient(process.env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, timeout: 15000 });
const storage = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!).storage.from(process.env.SUPABASE_STORAGE_BUCKET!);
try {
  const sources = [...await sql`select s.report_id, s.file_ids,r.author_id from slack_incoming_reports s join reports r on r.id=s.report_id where jsonb_array_length(s.file_ids)>0`];
  const reportId = process.argv.find(arg => arg.startsWith("--report="))?.slice(9);
  if (reportId) {
    sources.length = 0;
    const [binding] = await sql`select b.*,r.author_id from integration_bindings b join reports r on r.id=b.report_id where report_id=${reportId}`;
    const { SlackWebCommentAdapter } = await import("../src/server/integrations/slack-comments");
    const replies = await SlackWebCommentAdapter.fromToken(process.env.SLACK_BOT_TOKEN!).listReplies({channel:binding.slack_channel_id,threadTs:binding.slack_message_ts});
    sources.push({report_id:reportId,author_id:binding.author_id,file_ids:replies.flatMap(reply => (reply.files??[]).map(file=>file.id).filter(Boolean))});
  }
  for (const source of sources) {
    for (const id of source.file_ids) {
      const [done] = await sql`select file_id from slack_media_imports where report_id=${source.report_id} and file_id=${id}`;
      if (done) continue;
      const { file } = await client.files.info({ file: id });
      if (!file?.size || file.size <= 50_000_000 || !file.mimetype?.startsWith("video/") || !file.url_private) continue;
      const dir = await mkdtemp(join(tmpdir(), "hanabi-video-"));
      try {
        const response = await fetch(file.url_private, { headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
        if (!response.ok) throw new Error(`Download failed ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length !== file.size) throw new Error("Download incomplete");
        const input = join(dir, "source.mp4"), output = join(dir, "web.mp4");
        await writeFile(input, bytes, { mode: 0o600 });
        const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", input]);
        const duration = Number(stdout.trim());
        if (!(duration > 0)) throw new Error("Missing video duration");
        const bitrate = Math.max(100, Math.floor(40_000_000 * 8 / duration / 1000) - 128);
        await run("ffmpeg", ["-v", "error", "-i", input, "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-b:v", `${bitrate}k`, "-maxrate", `${bitrate}k`, "-bufsize", `${bitrate * 2}k`, "-preset", "fast", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", output], { maxBuffer: 1024 * 1024 });
        const compressed = await readFile(output);
        if (compressed.length > 47 * 1024 * 1024) throw new Error("Compressed video still too large");
        const path = `${source.author_id}/slack/${source.report_id}/${id}`;
        for (let attempt = 0; ; attempt++) {
          const { error } = await storage.upload(path, compressed, { contentType: "video/mp4", upsert: true });
          if (!error) break;
          if (attempt >= 2) {
            const signed = await storage.createSignedUploadUrl(path, { upsert: true });
            if (signed.error || !signed.data) throw new Error("Could not create retry upload URL");
            const retry = await run("curl", ["--silent", "--show-error", "--retry", "3", "--retry-all-errors", "--request", "PUT", "--header", "Content-Type: video/mp4", "--data-binary", `@${output}`, "--output", join(dir, "response.json"), "--write-out", "%{http_code}", signed.data.signedUrl]).catch(() => { throw new Error("Retry upload failed"); });
            if (!/^2\d\d$/.test(retry.stdout.trim())) throw new Error(`Retry upload HTTP ${retry.stdout.trim()}`);
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        await sql`insert into slack_media_imports(report_id,file_id,storage_path,filename,mime_type,size_bytes)
          values (${source.report_id},${id},${path},${file.name || `${id}.mp4`},'video/mp4',${compressed.length}) on conflict do nothing`;
        console.log(JSON.stringify({ file: id, originalBytes: bytes.length, importedBytes: compressed.length }));
      } finally { await rm(dir, { recursive: true, force: true }); }
    }
  }
} finally { await sql.end(); }
