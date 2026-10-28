import "server-only";

import { after } from "next/server";
import { processReportJobs } from "@/server/integrations/outbox";
import { processMentionNotifications } from "@/server/integrations/mention-notifications";

/** Publish first so the DM can link to the actual Slack thread. */
export function scheduleReportJobs(reportId: string): void {
  after(async () => {
    try { await processReportJobs(reportId); }
    catch { console.error("Deferred report integration retained for cron retry", { reportId }); }
    try { await processMentionNotifications(reportId); }
    catch { console.error("Deferred mention DM retained for cron retry", { reportId }); }
  });
}
