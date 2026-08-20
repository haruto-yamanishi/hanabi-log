create table if not exists member_contribution_events (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  occurred_at timestamptz not null,
  kind text not null check (kind in ('report', 'comment')),
  event_key text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists member_contribution_events_member_time_idx
  on member_contribution_events (member_id, occurred_at desc);

insert into member_contribution_events (member_id, occurred_at, kind, event_key)
select author_id, coalesce(published_at, created_at), 'report', 'report:' || id::text
from reports
where status in ('published', 'archived')
on conflict (event_key) do nothing;

alter table member_contribution_events enable row level security;
