alter table attachments
  add column if not exists notion_file_upload_id text;

comment on column attachments.notion_file_upload_id is
  'Notion File Upload ID saved before image append so retries do not upload the same bytes again.';
