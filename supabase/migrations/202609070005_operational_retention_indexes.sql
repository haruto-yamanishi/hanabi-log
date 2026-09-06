-- Indexes used by bounded retention cleanup. Long-lived domain records such as
-- reports are intentionally excluded from automated retention.
create index if not exists idempotency_keys_created_at_idx
  on idempotency_keys (created_at);

create index if not exists outbox_jobs_completed_retention_idx
  on outbox_jobs (completed_at)
  where status = 'delivered' and completed_at is not null;

create index if not exists outbox_jobs_dead_retention_idx
  on outbox_jobs (created_at)
  where status = 'dead';

create index if not exists slack_incoming_reports_processed_retention_idx
  on slack_incoming_reports (created_at)
  where processed_at is not null;

create index if not exists slack_report_reactions_processed_retention_idx
  on slack_report_reactions (event_ts)
  where processed_at is not null;
