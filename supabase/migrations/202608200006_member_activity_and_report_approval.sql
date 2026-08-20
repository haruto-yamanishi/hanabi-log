alter table members
  add column if not exists is_active boolean not null default true;

alter type report_status
  add value if not exists 'pending_approval' before 'published';

create index if not exists members_activity_idx
  on members (is_active, display_name, id);
