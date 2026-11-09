import { apiResponse, reportId } from "@/app/api/_shared";
import { getDatabase } from "@/server/db/client";
import { readStoredUpload } from "@/server/db/storage";
import { validSlackMediaToken } from "@/server/integrations/slack-media";
import { isImageMimeType } from "@/lib/media";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return apiResponse(async () => {
    const id = reportId((await context.params).id);
    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (!/^[a-f0-9]{64}$/.test(token)) return new Response(null, { status: 404 });
    const sql = getDatabase();
    const [attachment] = await sql`select a.storage_path, a.mime_type from attachments a
      join reports r on r.id = a.report_id where a.id = ${id} and r.status = 'published'`;
    if (!attachment || !isImageMimeType(attachment.mime_type) || !validSlackMediaToken(id, attachment.storage_path, token)) {
      return new Response(null, { status: 404 });
    }
    const { bytes } = await readStoredUpload(attachment.storage_path);
    return new Response(Buffer.from(bytes), { headers: { "Content-Type": attachment.mime_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
