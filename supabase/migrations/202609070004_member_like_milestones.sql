create table member_like_notifications (
  member_id uuid not null references members(id) on delete cascade,
  threshold bigint not null check (threshold >= 10),
  sent_at timestamptz,
  claimed_at timestamptz,
  last_error text,
  recipient_slack_user_id text,
  recipient_name text,
  message_text text,
  delivery_threshold bigint,
  slack_channel_id text,
  slack_message_ts text,
  primary key (member_id, threshold)
);
alter table member_like_notifications enable row level security;

-- 10, 20, 50, 100, 200, 500, ... without a fixed upper milestone.
create function member_like_milestones(total bigint) returns setof bigint
language plpgsql immutable as $$
declare
  magnitude numeric := 10;
  multiplier integer;
begin
  while magnitude <= total loop
    foreach multiplier in array array[1, 2, 5] loop
      if magnitude * multiplier <= total then
        return next (magnitude * multiplier)::bigint;
      end if;
    end loop;
    magnitude := magnitude * 10;
  end loop;
end;
$$;

create function enqueue_member_like_notifications() returns trigger language plpgsql as $$
declare
  author uuid;
  total bigint;
begin
  select author_id into author from reports where id = new.report_id;
  -- Likes on different reports of the same author must see a consistent total.
  perform 1 from members where id = author for no key update;
  select count(*) into total from report_likes likes
    join reports on reports.id = likes.report_id where reports.author_id = author;
  insert into member_like_notifications (member_id, threshold)
    select author, milestone from member_like_milestones(total) as milestone
    on conflict do nothing;
  return new;
end;
$$;
create trigger member_like_milestones after insert on report_likes
for each row execute function enqueue_member_like_notifications();

-- Include existing received likes; delivery combines historical milestones into one DM.
insert into member_like_notifications (member_id, threshold)
select totals.author_id, milestone
from (select reports.author_id, count(*) as total from report_likes likes
  join reports on reports.id = likes.report_id group by reports.author_id) totals
cross join lateral member_like_milestones(totals.total) as milestone
on conflict do nothing;
