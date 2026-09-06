import "server-only";
import { getDatabase } from "@/server/db/client";
import { isDemoMode } from "@/server/env";
import type { LikeNotificationHistory } from "@/lib/like-notification-history";

export async function listLikeNotificationHistory(): Promise<LikeNotificationHistory[]> {
  if (isDemoMode) return [];
  const sql = getDatabase();
  // Several milestones can share one DM. Show that delivery as one entry.
  const rows = await sql`select notification.report_id, reports.title,
      coalesce(notification.recipient_name, members.display_name) as recipient_name,
      coalesce(notification.recipient_slack_user_id, members.slack_user_id) as recipient_slack_user_id,
      notification.recipient_slack_user_id is not null as recipient_recorded,
      array_agg(notification.threshold order by notification.threshold) as thresholds,
      notification.message_text, notification.sent_at, notification.claimed_at, notification.last_error
    from report_like_notifications notification
    join reports on reports.id = notification.report_id
    join members on members.id = reports.author_id
    group by notification.report_id, reports.title, members.display_name, members.slack_user_id,
      notification.recipient_name, notification.recipient_slack_user_id, notification.message_text,
      notification.sent_at, notification.claimed_at, notification.last_error,
      coalesce(notification.delivery_threshold, notification.threshold)
    order by coalesce(notification.sent_at, notification.claimed_at) desc nulls last,
      notification.report_id, max(notification.threshold) desc
    limit 100`;
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  return rows.map(row => ({
    reportId: row.report_id, reportTitle: row.title,
    recipientName: row.recipient_name, recipientSlackUserId: row.recipient_slack_user_id,
    recipientRecorded: row.recipient_recorded, thresholds: row.thresholds,
    messageText: row.message_text, sentAt: iso(row.sent_at), attemptedAt: iso(row.claimed_at),
    status: row.sent_at ? "sent" : row.last_error ? "failed"
      : row.claimed_at && Date.now() - row.claimed_at.getTime() < 300000 ? "processing" : "pending",
    error: row.last_error,
  }));
}
