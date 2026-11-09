create table slack_video_uploads (
  report_id uuid not null references reports(id) on delete cascade,
  storage_path text not null,
  channel_id text not null,
  thread_ts text not null,
  file_id text,
  upload_url text,
  uploaded boolean not null default false,
  shared boolean not null default false,
  lease_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (report_id, storage_path)
);
alter table slack_video_uploads enable row level security;
revoke all on slack_video_uploads from public, anon, authenticated;
