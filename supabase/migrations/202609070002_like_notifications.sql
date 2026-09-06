alter table integration_bindings add column slack_reactions_imported_at timestamptz;

create table report_like_notifications (
  report_id uuid not null references reports(id) on delete cascade,
  threshold integer not null check (threshold in (5, 10, 20, 30)),
  sent_at timestamptz,
  claimed_at timestamptz,
  last_error text,
  primary key (report_id, threshold)
);
alter table report_like_notifications enable row level security;

-- A row in report_likes already represents one person across Slack and Web.
-- Capture milestones in the same transaction so a quick unlike cannot lose one.
create function enqueue_report_like_notifications() returns trigger language plpgsql as $$
begin
  insert into report_like_notifications (report_id, threshold)
  select new.report_id, threshold
  from unnest(array[5, 10, 20, 30]) as threshold
  where threshold < (select count(*) from report_likes where report_id = new.report_id)
    and exists (select 1 from reports where id = new.report_id and status = 'published')
  on conflict do nothing;
  return new;
end;
$$;
create trigger report_like_milestones after insert on report_likes
for each row execute function enqueue_report_like_notifications();

-- Existing likes are eligible too; delivery combines pending milestones per report.
insert into report_like_notifications (report_id, threshold)
select reports.id, threshold
from reports cross join unnest(array[5, 10, 20, 30]) as threshold
where reports.status = 'published'
  and threshold < (select count(*) from report_likes where report_id = reports.id)
on conflict do nothing;
