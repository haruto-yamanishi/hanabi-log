-- Retry/dead-letter state for Slack ingestion so poison events cannot block later work.
-- This uses 0007 because 0002-0005 are already occupied on current main and
-- the open API rate-limit rollout reserves 0006.
alter table slack_incoming_reports add column if not exists attempts integer not null default 0 check (attempts >= 0);
alter table slack_incoming_reports add column if not exists available_at timestamptz not null default now();
alter table slack_incoming_reports add column if not exists last_error text;
alter table slack_incoming_reports add column if not exists dead_at timestamptz;

create index if not exists slack_incoming_reports_ready_idx
  on slack_incoming_reports (available_at, created_at)
  where processed_at is null and dead_at is null;

alter table slack_report_reactions add column if not exists attempts integer not null default 0 check (attempts >= 0);
alter table slack_report_reactions add column if not exists available_at timestamptz not null default now();
alter table slack_report_reactions add column if not exists last_error text;
alter table slack_report_reactions add column if not exists dead_at timestamptz;

create index if not exists slack_report_reactions_ready_idx
  on slack_report_reactions (available_at)
  where processed_at is null and dead_at is null;
