alter table reports drop constraint if exists content_category_allowed;
alter table reports add constraint content_category_allowed check (content_category in ('進捗','判断・意思決定','調査・学び','課題・相談','会議・共有','留学・進路','成果','次のアクション'));
create table if not exists slack_media_imports (
  report_id uuid not null references reports(id) on delete cascade,
  file_id text not null,
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now(),
  primary key (report_id, file_id)
);
alter table slack_media_imports enable row level security;

alter table slack_incoming_reports add column if not exists file_ids jsonb not null default '[]';
alter table slack_incoming_reports add column if not exists media_imported_at timestamptz;

alter table slack_incoming_reports add column if not exists media_error text;
alter table slack_incoming_reports add column if not exists historical boolean not null default false;
