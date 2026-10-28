import "server-only";

import { after } from "next/server";
import { processReportJobs } from "@/server/integrations/outbox";
import { processMentionNotifications } from "@/server/integrations/mention-notifications";

/** Start independent deliveries after the response; durable jobs remain for cron retries. */
export function scheduleReportJobs(reportId: string): void {
  after(async () => {
    const results = await Promise.allSettled([
      processReportJobs(reportId),
      processMentionNotifications(reportId),
    ]);
    results.forEach((result, index) => {
      if (result.status === "rejected") console.error("Deferred report delivery retained for cron retry", {
        reportId, target: index === 0 ? "integrations" : "mention",
      });
    });
  });
}
