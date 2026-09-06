alter table integration_bindings add column if not exists slack_source_message boolean not null default false;

-- Durable receipt also prevents duplicate reports after Slack retries or Web deletion.
create table if not exists slack_incoming_reports (
  channel_id text not null,
  message_ts text not null,
  user_id text not null,
  body text not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (channel_id, message_ts)
);
alter table slack_incoming_reports enable row level security;
