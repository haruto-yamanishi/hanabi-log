create table if not exists notion_oauth_connections (
  id text primary key default 'primary',
  workspace_id text not null,
  workspace_name text,
  workspace_icon_url text,
  bot_id text not null,
  owner_user_id text,
  owner_user_name text,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text,
  connected_by_member_id uuid references members(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notion_oauth_singleton check (id = 'primary')
);

comment on table notion_oauth_connections is
  'Singleton Notion OAuth installation. Tokens are encrypted with the server-only NOTION_TOKEN_ENCRYPTION_KEY before storage.';

alter table notion_oauth_connections enable row level security;
