-- Presence is approximate (visible browser heartbeat); no IP or browsing paths stored.
create table member_presence (
  member_id uuid primary key references members(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
create table report_page_views (
  visit_id uuid primary key,
  report_id uuid not null references reports(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index report_page_views_report_idx on report_page_views(report_id);
alter table member_presence enable row level security;
alter table report_page_views enable row level security;
revoke all on member_presence, report_page_views from public, anon, authenticated;
create table analytics_settings (
  id boolean primary key default true check (id),
  started_at timestamptz not null default now()
);
alter table analytics_settings enable row level security;
revoke all on analytics_settings from public, anon, authenticated;
insert into analytics_settings (id) values (true);
