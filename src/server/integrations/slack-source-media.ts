import "server-only";
import { getDatabase } from "@/server/db/client";
import { importSlackFile } from "@/server/integrations/slack-file-import";
import { isMediaMimeType } from "@/lib/media";

export async function importSourceMedia() {
  const sql = getDatabase();
  const rows = await sql`select channel_id,message_ts,report_id,file_ids from slack_incoming_reports
    where report_id is not null and media_imported_at is null and processed_at is not null limit 20`;
  for (const row of rows) {
    try {
      for (const id of row.file_ids as string[]) {
        const file = await importSlackFile(row.report_id, id);
        if (!isMediaMimeType(file.mime_type)) throw new Error(`Unsupported source media: ${file.mime_type}`);
        await sql.begin(async tx => {
          await tx`select id from reports where id = ${row.report_id} for update`;
          await tx`insert into attachments (report_id,storage_path,filename,mime_type,size_bytes,sort_order)
            select ${row.report_id},${file.storage_path},${file.filename},${file.mime_type},${file.size_bytes},
              (select count(*) from attachments where report_id = ${row.report_id})
            where not exists (select 1 from attachments where report_id = ${row.report_id} and storage_path = ${file.storage_path})`;
        });
      }
      await sql`update slack_incoming_reports set media_imported_at = now(), media_error = null
        where channel_id = ${row.channel_id} and message_ts = ${row.message_ts} and file_ids = ${sql.json(row.file_ids)}`;
    } catch (error) {
      await sql`update slack_incoming_reports set media_error = ${error instanceof Error ? error.message : "Media import failed"}
        where channel_id = ${row.channel_id} and message_ts = ${row.message_ts}`;
    }
  }
}
