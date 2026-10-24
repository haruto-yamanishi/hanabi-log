alter table report_comments add column attachments jsonb not null default '[]' check (jsonb_typeof(attachments) = 'array');
alter table integration_bindings add column comment_media_sync_requested_at timestamptz;
