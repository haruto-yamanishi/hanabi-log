alter table report_likes add column if not exists web_comment_liked boolean not null default false;

create table report_comments (
  report_id uuid not null references reports(id) on delete cascade,
  message_ts text not null,
  author_id uuid references members(id) on delete set null,
  body text not null,
  source text not null check(source in ('web','slack')),
  created_at timestamptz not null,
  primary key(report_id,message_ts)
);
create index report_comments_author on report_comments(author_id);
alter table report_comments enable row level security;

create table report_comment_likes (
  report_id uuid not null,
  message_ts text not null,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(report_id,message_ts,member_id),
  foreign key(report_id,message_ts) references report_comments(report_id,message_ts) on delete cascade
);
alter table report_comment_likes enable row level security;

-- Report authors receive one like per person across all three independent sources.
create function sync_web_comment_report_like() returns trigger language plpgsql as $$
declare target_report uuid; target_member uuid; has_comment_like boolean;
begin
  target_report := coalesce(new.report_id, old.report_id);
  target_member := coalesce(new.member_id, old.member_id);
  perform 1 from reports where id=target_report for update;
  select exists(select 1 from report_comment_likes where report_id=target_report and member_id=target_member) into has_comment_like;
  if has_comment_like then
    insert into report_likes(report_id,member_id,web_liked,slack_liked,web_comment_liked)
    values(target_report,target_member,false,false,true)
    on conflict(report_id,member_id) do update set web_comment_liked=true;
  else
    update report_likes set web_comment_liked=false where report_id=target_report and member_id=target_member;
    delete from report_likes where report_id=target_report and member_id=target_member and not web_liked and not slack_liked and not web_comment_liked;
  end if;
  return coalesce(new,old);
end;
$$;
create trigger sync_comment_like after insert or delete on report_comment_likes
for each row execute function sync_web_comment_report_like();

-- Multiple emoji and Web/Slack overlaps count once per person per comment.
create view comment_like_members as
select report_id,message_ts,member_id from report_comment_likes
union
select c.report_id,c.message_ts,m.id as member_id
from report_comments c
join integration_bindings b on b.report_id=c.report_id
join slack_report_reactions s on s.channel_id=b.slack_channel_id and s.message_ts=c.message_ts and s.active
join reports r on r.id=c.report_id
join members author on author.id=r.author_id
join members m on m.slack_user_id=s.user_id and m.slack_team_id=author.slack_team_id;

revoke all on comment_like_members from public, anon, authenticated;
