create table member_role_notifications (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id) on delete cascade,
  actor_id uuid references members(id) on delete set null,
  actor_name text not null,
  actor_slack_user_id text not null,
  role member_role not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text
);

create index member_role_notifications_pending_idx
  on member_role_notifications (available_at, created_at)
  where delivered_at is null;

alter table member_role_notifications enable row level security;
revoke all on member_role_notifications from anon, authenticated;

alter table system_dm_deliveries drop constraint system_dm_deliveries_kind_check;
alter table system_dm_deliveries add constraint system_dm_deliveries_kind_check
  check (kind in ('like', 'contribution_nudge', 'announcement', 'publication', 'role_change'));
