alter type member_role add value if not exists 'media';
create table publication_requests (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  author_id uuid not null references members(id) on delete cascade,
  requester_id uuid not null references members(id) on delete cascade,
  version integer not null default 1,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index publication_requests_report on publication_requests(report_id, created_at desc);
create index publication_requests_author on publication_requests(author_id, created_at desc);
create index publication_requests_requester on publication_requests(requester_id, created_at desc);
alter table publication_requests enable row level security;
revoke all on publication_requests from public, anon, authenticated;

create table publication_notifications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references publication_requests(id) on delete cascade,
  request_version integer not null,
  recipient_id uuid not null references members(id) on delete cascade,
  message_text text not null,
  blocks jsonb not null default '[]',
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  unique(request_id, request_version, recipient_id)
);
create index publication_notifications_pending on publication_notifications(available_at) where delivered_at is null;
alter table publication_notifications enable row level security;
revoke all on publication_notifications from public, anon, authenticated;
alter table system_dm_deliveries add column blocks jsonb not null default '[]';
alter table system_dm_deliveries drop constraint system_dm_deliveries_kind_check;
alter table system_dm_deliveries add constraint system_dm_deliveries_kind_check check(kind in ('like','contribution_nudge','announcement','publication'));
