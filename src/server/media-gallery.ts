import "server-only";
import { AppError } from "@/server/errors";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { isDemoMode } from "@/server/env";
import { getReportRepository } from "@/server/repositories";
import type { CurrentUser } from "@/lib/types";
import type { MediaItem, MediaPage } from "@/lib/media-gallery";

export const mediaFilters = z.object({
  kind: z.enum(["all", "image", "video"]).default("all"),
  source: z.enum(["all", "report", "comment"]).default("all"),
  cursor: z.string().max(500).optional(),
});
const cursorSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), id: z.string().min(1).max(200) });
type Row = { id: string; report_id: string; title: string; report_date: string; author_id: string; display_name: string; filename: string; mime_type: string; source: "report" | "comment"; comment_id: string | null; storage_path: string | null; file_id: string | null };
function selection(actor: CurrentUser) {
  const sql = getDatabase();
  return sql`select 'report:' || a.id as id, r.id as report_id, r.title, r.report_date::text, r.author_id, m.display_name,
      a.filename, a.mime_type, 'report' as source, null::text as comment_id, a.storage_path, null::text as file_id
    from attachments a join reports r on r.id=a.report_id join members m on m.id=r.author_id
    where r.status in ('published','archived') and (r.status='published' or r.author_id=${actor.id} or ${actor.role === 'admin'})
    union all
    select 'comment:' || c.report_id || ':' || c.message_ts || ':' || (f->>'id'), r.id, r.title, r.report_date::text, r.author_id, m.display_name,
      f->>'filename', f->>'mimeType', 'comment', c.message_ts, i.storage_path, f->>'id'
    from report_comments c join reports r on r.id=c.report_id join members m on m.id=r.author_id
      cross join lateral jsonb_array_elements(c.attachments) f
      left join slack_media_imports i on i.report_id=c.report_id and i.file_id=f->>'id'
    where r.status in ('published','archived') and (r.status='published' or r.author_id=${actor.id} or ${actor.role === 'admin'}) and (f->>'mimeType' like 'image/%' or f->>'mimeType' like 'video/%')`;
}
function dto(row: Row): MediaItem {
  return { id: row.id, reportId: row.report_id, title: row.title, reportDate: row.report_date, authorId: row.author_id, authorName: row.display_name, filename: row.filename, mimeType: row.mime_type, source: row.source, ...(row.comment_id ? { commentId: row.comment_id } : {}), url: `/api/media/file?${new URLSearchParams({ id: row.id })}` };
}
export async function findMedia(id: string, actor: CurrentUser): Promise<Row | undefined> {
  if (isDemoMode) return (await demoRows(actor)).find(row => row.id === id);
  const sql = getDatabase();
  const [row] = await sql<Row[]>`with media as (${selection(actor)}) select * from media where id=${id} limit 1`;
  return row;
}
async function demoRows(actor: CurrentUser): Promise<Row[]> {
  const repo = getReportRepository();
  const rows: Row[] = [];
  for (const status of ["published", "archived"] as const) {
    let cursor: string | undefined;
    do {
      const page = await repo.listReports({ status, limit: 100, cursor }, actor);
      for (const item of page.reports) {
        const report = await repo.getReadableReport(item.id, actor);
        for (const [index, file] of (report?.attachments ?? []).entries()) rows.push({ id: `report:${file.id ?? `${item.id}:${index}`}`, report_id: item.id, title: item.title, report_date: item.reportDate, author_id: item.authorId, display_name: item.author.displayName, filename: file.filename, mime_type: file.mimeType, source: "report", comment_id: null, storage_path: file.storagePath, file_id: null });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  return rows;
}
export async function listMedia(filters: z.infer<typeof mediaFilters>, actor: CurrentUser): Promise<MediaPage> {
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (filters.cursor) {
    try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(filters.cursor, "base64url").toString())); }
    catch { throw new AppError("INVALID_CURSOR", "一覧を再読み込みしてください", 422); }
  }
  let rows: Row[];
  if (isDemoMode) {
    rows = (await demoRows(actor)).filter(row => (filters.kind === "all" || row.mime_type.startsWith(`${filters.kind}/`)) && (filters.source === "all" || row.source === filters.source) && (!cursor || row.report_date < cursor.date || (row.report_date === cursor.date && row.id < cursor.id)))
      .sort((a,b) => b.report_date.localeCompare(a.report_date) || b.id.localeCompare(a.id)).slice(0, 25);
  } else {
    const sql = getDatabase();
    rows = await sql<Row[]>`with media as (${selection(actor)}) select * from media where
      (${filters.kind === "all"} or mime_type like ${`${filters.kind}/%`}) and
      (${filters.source === "all"} or source=${filters.source})
      ${cursor ? sql`and (report_date,id) < (${cursor.date},${cursor.id})` : sql``}
      order by report_date desc,id desc limit 25`;
  }
  const items = rows.slice(0,24).map(dto);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > 24 && last ? Buffer.from(JSON.stringify({ date: last.reportDate, id: last.id })).toString("base64url") : null };
}
