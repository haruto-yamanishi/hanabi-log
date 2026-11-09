import "server-only";
import { WebClient } from "@slack/web-api";
import { roleChangeNotice } from "@/lib/role-change-notice";
import type { Member } from "@/lib/types";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";
import { sendSystemDm } from "@/server/integrations/system-dm";

export async function processMemberRoleNotifications(): Promise<void> {
  if (isDemoMode || !env.SLACK_BOT_TOKEN) return;
  const sql = getDatabase();
  const rows = await sql`update member_role_notifications
    set lease_until = now() + interval '2 minutes', attempts = attempts + 1
    where id in (select id from member_role_notifications
      where delivered_at is null and available_at <= now() and attempts < 8
        and (lease_until is null or lease_until < now())
      order by created_at, id limit 10 for update skip locked)
    returning *`;
  const client = new WebClient(env.SLACK_BOT_TOKEN, {
    retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 15000,
  });
  for (const row of rows) {
    try {
      const [recipient] = await sql`select slack_user_id, display_name from members where id = ${row.member_id}`;
      if (!recipient) throw new Error("Recipient missing");
      await sendSystemDm(client, {
        dedupeKey: `role_change:${row.id}`,
        kind: "role_change",
        recipientSlackUserId: recipient.slack_user_id,
        recipientName: recipient.display_name,
        text: roleChangeNotice(row.role as Member["role"], row.actor_name, row.actor_slack_user_id),
      });
      await sql`update member_role_notifications set delivered_at = now(), lease_until = null, last_error = null where id = ${row.id}`;
    } catch {
      await sql`update member_role_notifications set lease_until = null,
        last_error = 'Slack DMの送信を確認できませんでした',
        available_at = now() + interval '5 minutes' where id = ${row.id}`;
    }
  }
}
