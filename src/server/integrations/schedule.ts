import "server-only";

import { after } from "next/server";
import { processReportJobs } from "@/server/integrations/outbox";

/**
 * Starts delivery only after the HTTP response is sent. The durable Outbox job
 * remains available to the scheduled worker if this best-effort run fails.
 */
export function scheduleReportJobs(reportId: string): void {
  after(async () => {
    try {
      await processReportJobs(reportId);
    } catch (error) {
      console.error("Deferred report integration processing failed", { reportId, error });
    }
  });
}
