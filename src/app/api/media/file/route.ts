import { z } from "zod";
import { apiResponse, notFound } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { findMedia } from "@/server/media-gallery";
import { createSignedReadUrl } from "@/server/db/storage";
import { importSlackFile } from "@/server/integrations/slack-file-import";
export const maxDuration = 300;
export async function GET(request: Request) {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    const id = z.string().min(1).max(200).parse(new URL(request.url).searchParams.get("id"));
    const row = await findMedia(id, actor);
    if (!row) notFound();
    let storagePath = row.storage_path;
    if (!storagePath && row.file_id) {
      try { storagePath = (await importSlackFile(row.report_id, row.file_id)).storage_path; }
      catch (error) {
        if (error instanceof Error && error.message === "Slack file exceeds storage limit" && row.mime_type.startsWith("video/")) {
          return new Response(null, { status: 307, headers: { Location: `/api/reports/${row.report_id}/comments/files/${row.file_id}`, "Cache-Control": "private, no-store" } });
        }
        throw error;
      }
    }
    if (!storagePath) notFound();
    return new Response(null, { status: 307, headers: { Location: await createSignedReadUrl(storagePath, new URL(request.url).origin), "Cache-Control": "private, no-store" } });
  });
}
