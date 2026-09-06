create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_member_id uuid,
  actor_role text,
  action text not null check (length(action) between 1 and 120),
  target_type text not null check (length(target_type) between 1 and 80),
  target_id text,
  source text not null default 'web' check (length(source) between 1 and 40),
  request_id text,
  before_json jsonb,
  after_json jsonb,
  metadata_json jsonb not null default '{}'::jsonb
);

create index if not exists audit_events_occurred_at_idx
  on audit_events (occurred_at desc);
create index if not exists audit_events_actor_idx
  on audit_events (actor_member_id, occurred_at desc);
create index if not exists audit_events_target_idx
  on audit_events (target_type, target_id, occurred_at desc);
create index if not exists audit_events_action_idx
  on audit_events (action, occurred_at desc);

alter table audit_events enable row level security;

-- Audit history is append-only. Even privileged application SQL must not
-- silently rewrite history; intentional break-glass maintenance requires
-- explicitly disabling/removing this trigger in a controlled operation.
create or replace function prevent_audit_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_events is append-only';
end;
$$;

drop trigger if exists audit_events_append_only on audit_events;
create trigger audit_events_append_only
before update or delete on audit_events
for each row execute function prevent_audit_event_mutation();

revoke update, delete, truncate on audit_events from public, anon, authenticated;
