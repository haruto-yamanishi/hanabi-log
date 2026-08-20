alter table member_contribution_events
  add column if not exists report_id uuid references reports(id) on delete cascade;

update member_contribution_events
set report_id = substring(event_key from '^report:(.+)$')::uuid
where kind = 'report' and report_id is null and event_key ~ '^report:[0-9a-f-]{36}$';

create index if not exists member_contribution_events_report_kind_idx
  on member_contribution_events (report_id, kind);
