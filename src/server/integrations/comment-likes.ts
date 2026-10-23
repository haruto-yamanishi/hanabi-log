import "server-only";
import type { CurrentUser, ReportComment } from "@/lib/types";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";

export async function rememberComments(reportId: string, comments: ReportComment[]): Promise<void> {
  if (isDemoMode || !comments.length) return;
  const sql = getDatabase();
  const unknown = comments.filter(comment => !comment.author.id && /^[UW][A-Z0-9]+$/.test(comment.author.slackUserId ?? ""));
  if (unknown.length && env.SLACK_TEAM_ID) {
    const authors = [...new Map(unknown.map(comment => [comment.author.slackUserId!, comment.author])).values()];
    const rows = authors.map(author => ({ slack_team_id: env.SLACK_TEAM_ID!, slack_user_id: author.slackUserId!, display_name: author.displayName, avatar_url: author.avatarUrl ?? null }));
    await sql`insert into members ${sql(rows, "slack_team_id", "slack_user_id", "display_name", "avatar_url")}
      on conflict(slack_team_id,slack_user_id) do nothing`;
    const members = await sql`select id,slack_user_id from members where slack_team_id=${env.SLACK_TEAM_ID} and slack_user_id in ${sql(authors.map(author => author.slackUserId!))}`;
    for (const comment of unknown) comment.author.id = members.find(member => member.slack_user_id === comment.author.slackUserId)?.id;
  }
  const rows = comments.map(comment => ({ report_id: reportId, message_ts: comment.id, author_id: comment.author.id ?? null, body: comment.body, source: comment.source, created_at: comment.createdAt }));
  await sql`insert into report_comments ${sql(rows, "report_id", "message_ts", "author_id", "body", "source", "created_at")}
    on conflict(report_id,message_ts) do update set author_id=coalesce(excluded.author_id,report_comments.author_id),body=excluded.body`;
  const events = comments.flatMap(comment => comment.author.id ? [{ member_id: comment.author.id, report_id: reportId, occurred_at: comment.createdAt, kind: "comment", event_key: `comment:${reportId}:${comment.source}:${comment.id}` }] : []);
  if (events.length) await sql`insert into member_contribution_events ${sql(events,"member_id","report_id","occurred_at","kind","event_key")} on conflict(event_key) do nothing`;
}

export async function withCommentLikes(reportId: string, comments: ReportComment[], actorId: string): Promise<ReportComment[]> {
  if (isDemoMode) return comments.map(comment => ({ ...comment, likeCount: 0, likedByCurrentUser: false }));
  const sql = getDatabase();
  const counts = await sql`select c.message_ts,
    (select count(*)::int from comment_like_members l where l.report_id=c.report_id and l.message_ts=c.message_ts) as count,
    exists(select 1 from report_comment_likes w where w.report_id=c.report_id and w.message_ts=c.message_ts and w.member_id=${actorId}) as liked
    from report_comments c where c.report_id=${reportId}`;
  const byId = new Map(counts.map(row => [row.message_ts, row]));
  return comments.map(comment => {
    const { slackUserId: _providerId, ...author } = comment.author;
    void _providerId;
    return { ...comment, author, likeCount: byId.get(comment.id)?.count ?? 0, likedByCurrentUser: byId.get(comment.id)?.liked ?? false };
  });
}

export async function setCommentLike(reportId: string, messageTs: string, actor: CurrentUser, liked: boolean) {
  const sql = getDatabase();
  return sql.begin(async tx => {
    const [report] = await tx`select status from reports where id=${reportId} for update`;
    if (!report || report.status !== "published") throw new AppError("COMMENTS_NOT_AVAILABLE", "公開中の日報のコメントにだけいいねできます", 409);
    const [comment] = await tx`select message_ts from report_comments where report_id=${reportId} and message_ts=${messageTs}`;
    if (!comment) throw new AppError("NOT_FOUND", "コメントが見つかりません。再読み込みしてください", 404);
    if (liked) {
      await tx`insert into report_comment_likes(report_id,message_ts,member_id) values(${reportId},${messageTs},${actor.id}) on conflict do nothing`;
    } else {
      await tx`delete from report_comment_likes where report_id=${reportId} and message_ts=${messageTs} and member_id=${actor.id}`;
    }
    const [result] = await tx`select count(*)::int as count from comment_like_members where report_id=${reportId} and message_ts=${messageTs}`;
    return { likeCount: result.count as number, likedByCurrentUser: liked };
  });
}
