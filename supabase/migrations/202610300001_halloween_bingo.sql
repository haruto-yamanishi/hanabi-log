create table if not exists halloween_bingo_campaign (
 id text primary key, starts_at timestamptz not null, ends_at timestamptz not null,
 announce_at timestamptz not null, channel_id text, scheduled_message_id text, thread_ts text
);
insert into halloween_bingo_campaign(id, starts_at, ends_at, announce_at)
values ('2026', '2026-10-29T17:42:32.753Z', '2026-11-06T10:00:00Z', '2026-10-30T10:00:00Z') on conflict do nothing;
create table if not exists halloween_bingo_entries (
 member_id uuid primary key references members(id), report_id uuid references reports(id) on delete set null,
 qualified_at timestamptz not null, notified_ts text, attempted_at timestamptz
);
alter table halloween_bingo_campaign enable row level security;
alter table halloween_bingo_entries enable row level security;
create or replace function capture_halloween_bingo_entry() returns trigger language plpgsql as $$
begin
 if new.status = 'published' and new.author_id <> 'd5160b27-186c-45bd-84ec-71704239f44b'::uuid
 and exists(select 1 from halloween_bingo_campaign where id='2026' and new.published_at > starts_at and new.published_at < ends_at) then
 insert into halloween_bingo_entries(member_id,report_id,qualified_at) values(new.author_id,new.id,new.published_at) on conflict do nothing;
 end if;
 return new;
end $$;
drop trigger if exists halloween_bingo_entry on reports;
create trigger halloween_bingo_entry after insert or update on reports for each row execute function capture_halloween_bingo_entry();
insert into halloween_bingo_entries(member_id,report_id,qualified_at)
select distinct on(r.author_id) r.author_id,r.id,r.published_at from reports r cross join halloween_bingo_campaign c
where c.id='2026' and r.status in ('published','archived') and r.published_at > c.starts_at and r.published_at < c.ends_at
and r.author_id <> 'd5160b27-186c-45bd-84ec-71704239f44b'::uuid
order by r.author_id,r.published_at,r.id on conflict do nothing;
