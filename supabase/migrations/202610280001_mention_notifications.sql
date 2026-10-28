-- Record mentions in the same transaction as publication/editing, including imports.
create table report_mention_notifications (
  report_id uuid not null references reports(id) on delete cascade,
  target_id text not null,
  recipients jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  last_error text,
  primary key (report_id, target_id)
);
alter table report_mention_notifications enable row level security;
revoke all on report_mention_notifications from anon, authenticated;
create index report_mention_notifications_pending_idx on report_mention_notifications(available_at)
  where delivered_at is null;

create function report_mention_targets(body text) returns table(target_id text)
language sql immutable as $$
  select distinct coalesce(m[1], m[2], m[3]) from regexp_matches(body,
    E'@\\[[^\\]\\n]+\\]\\(slack:([UWS][A-Z0-9]+)\\)|<@([UW][A-Z0-9]+)(?:\\|[^>]+)?>|<!subteam\\^(S[A-Z0-9]+)(?:\\|[^>]+)?>', 'g') m
$$;
create function queue_report_mentions() returns trigger language plpgsql as $$
begin
  if new.status = 'published' then
    insert into report_mention_notifications(report_id, target_id)
    select new.id, target_id from report_mention_targets(concat_ws(E'\n',new.title,new.summary,
      new.activity_text,new.learning_text,new.issue_text,new.next_action_text))
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger report_mentions_after_write after insert or update on reports
  for each row execute function queue_report_mentions();

-- Existing public reports receive the same once-per-report notification.
insert into report_mention_notifications(report_id, target_id)
select r.id, t.target_id from reports r cross join lateral report_mention_targets(
  concat_ws(E'\n',r.title,r.summary,r.activity_text,r.learning_text,r.issue_text,r.next_action_text)) t
where r.status = 'published' on conflict do nothing;
