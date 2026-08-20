create table if not exists report_likes (
  report_id uuid not null references reports(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, member_id)
);

create index if not exists report_likes_member_idx
  on report_likes (member_id, created_at desc);

create table if not exists weekly_digest_deliveries (
  period_start date not null,
  period_end date not null,
  slack_channel_id text not null,
  slack_message_ts text,
  status text not null default 'processing',
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (period_start, slack_channel_id),
  constraint weekly_digest_period_valid check (period_end > period_start),
  constraint weekly_digest_status_allowed check (status in ('processing', 'delivered', 'failed'))
);

-- These tables are only accessed from the server with the PostgreSQL connection.
alter table report_likes enable row level security;
alter table weekly_digest_deliveries enable row level security;
