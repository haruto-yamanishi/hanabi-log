import "server-only";
import { getDatabase } from "@/server/db/client";
import { env, isDemoMode } from "@/server/env";

export const RETENTION_DAYS = {
  idempotencyKeys: 60,
  deliveredOutbox: 90,
  deadOutbox: 365,
  processedSlackEvents: 180,
  processedSlackReactions: 180,
  rateLimitWindows: 1,
} as const;

export interface RetentionCleanupSummary {
  idempotencyKeys: number;
  deliveredOutbox: number;
  deadOutbox: number;
  processedSlackEvents: number;
  processedSlackReactions: number;
  rateLimitWindows: number;
}

function emptySummary(): RetentionCleanupSummary {
  return {
    idempotencyKeys: 0,
    deliveredOutbox: 0,
    deadOutbox: 0,
    processedSlackEvents: 0,
    processedSlackReactions: 0,
    rateLimitWindows: 0,
  };
}

export async function cleanupOperationalData(
  batchSize = 500,
): Promise<RetentionCleanupSummary> {
  if (env.NODE_ENV === "test" || isDemoMode) return emptySummary();
  const limit = Math.min(2_000, Math.max(1, Math.floor(batchSize)));
  const sql = getDatabase();

  const idempotencyKeys = await sql`delete from idempotency_keys
    where ctid in (
      select ctid from idempotency_keys
      where created_at < now() - interval '60 days'
      order by created_at
      limit ${limit}
    ) returning 1`;

  const deliveredOutbox = await sql`delete from outbox_jobs
    where ctid in (
      select ctid from outbox_jobs
      where status = 'delivered'
        and completed_at is not null
        and completed_at < now() - interval '90 days'
      order by completed_at
      limit ${limit}
    ) returning 1`;

  const deadOutbox = await sql`delete from outbox_jobs
    where ctid in (
      select ctid from outbox_jobs
      where status = 'dead'
        and created_at < now() - interval '365 days'
      order by created_at
      limit ${limit}
    ) returning 1`;

  const processedSlackEvents = await sql`delete from slack_incoming_reports
    where ctid in (
      select ctid from slack_incoming_reports
      where processed_at is not null
        and created_at < now() - interval '180 days'
      order by created_at
      limit ${limit}
    ) returning 1`;

  const processedSlackReactions = await sql`delete from slack_report_reactions
    where ctid in (
      select reaction.ctid from slack_report_reactions reaction
      where reaction.processed_at is not null
        and to_timestamp(reaction.event_ts::double precision) < now() - interval '180 days'
        -- These rows are current per-message state, not disposable event logs.
        -- Keep active states and removal tombstones while their report exists.
        and not exists (
          select 1 from integration_bindings binding
          where binding.slack_channel_id = reaction.channel_id
            and binding.slack_message_ts = coalesce(reaction.slack_thread_ts, reaction.message_ts)
        )
      order by reaction.event_ts
      limit ${limit}
    ) returning 1`;

  const rateLimitWindows = await sql`delete from api_rate_limit_windows
    where ctid in (
      select ctid from api_rate_limit_windows
      where window_start < now() - interval '1 day'
      order by window_start
      limit ${limit}
    ) returning 1`;

  return {
    idempotencyKeys: idempotencyKeys.length,
    deliveredOutbox: deliveredOutbox.length,
    deadOutbox: deadOutbox.length,
    processedSlackEvents: processedSlackEvents.length,
    processedSlackReactions: processedSlackReactions.length,
    rateLimitWindows: rateLimitWindows.length,
  };
}
