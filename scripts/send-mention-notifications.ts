import { getDatabase } from "../src/server/db/client";
import { isDemoMode } from "../src/server/env";
import { processMentionNotifications } from "../src/server/integrations/mention-notifications";
const sql = getDatabase();
try {
  if (isDemoMode) throw new Error("Run with DEMO_MODE=false");
  const [counts] = await sql`select count(*)::int as targets, count(distinct n.report_id)::int as reports
    from report_mention_notifications n join reports r on r.id=n.report_id
    where r.status='published' and n.delivered_at is null`;
  console.log(JSON.stringify(counts));
  if (process.argv.includes("--apply")) {
    for (;;) {
      const result = await processMentionNotifications();
      console.log(JSON.stringify(result));
      if (!result.claimed) break;
    }
    const [status] = await sql`select count(*) filter(where status='sent')::int as sent,
      count(*) filter(where status<>'sent')::int as unresolved from system_dm_deliveries where dedupe_key like 'mention:%'`;
    console.log(JSON.stringify(status));
  }
} finally { await sql.end(); }
