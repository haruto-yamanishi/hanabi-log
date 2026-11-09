create table system_dm_deliveries (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  kind text not null check (kind in ('like', 'contribution_nudge', 'announcement')),
  recipient_slack_user_id text not null,
  recipient_name text not null,
  report_id uuid references reports(id) on delete set null,
  report_title text,
  message_text text not null,
  status text not null check (status in ('processing', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  attempted_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  slack_channel_id text,
  slack_message_ts text
);
create index system_dm_deliveries_history_idx on system_dm_deliveries (created_at desc);
alter table system_dm_deliveries enable row level security;
