create extension if not exists pg_trgm;

do $$ begin create type member_role as enum ('member', 'admin'); exception when duplicate_object then null; end $$;
do $$ begin create type report_status as enum ('draft', 'published', 'archived'); exception when duplicate_object then null; end $$;
do $$ begin create type delivery_target as enum ('slack', 'notion'); exception when duplicate_object then null; end $$;
do $$ begin create type delivery_status as enum ('pending', 'processing', 'delivered', 'partial', 'failed', 'dead'); exception when duplicate_object then null; end $$;

create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  slack_team_id text not null,
  slack_user_id text not null,
  display_name text not null,
  email text,
  avatar_url text,
  role member_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slack_team_id, slack_user_id)
);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references members(id),
  report_date date not null,
  title varchar(60) not null,
  summary varchar(100),
  activity_area text not null,
  content_category text not null,
  activity_text text not null,
  learning_text text,
  issue_text text,
  next_action_text text,
  theme_tags text[] not null default '{}',
  status report_status not null default 'draft',
  version integer not null default 1,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint title_not_blank check (length(trim(title)) > 0),
  constraint activity_not_blank check (length(trim(activity_text)) > 0),
  constraint theme_tag_count check (cardinality(theme_tags) <= 5),
  constraint activity_area_allowed check (activity_area in ('ロボット','アワード','アウトリーチ','ブランディング','チーム運営','資金調達・スポンサー','その他')),
  constraint content_category_allowed check (content_category in ('進捗','判断・意思決定','調査・学び','課題・相談','会議・共有','成果','次のアクション')),
  constraint theme_tags_allowed check (theme_tags <@ array['機械','電装','ソフトウェア','CAD・設計','製作','競技','スポンサー','広報・SNS','イベント','教育','採用・育成','その他']::text[])
);

create table if not exists related_links (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  label text not null,
  url text not null,
  sort_order integer not null default 0
);

create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  size_bytes integer not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists integration_bindings (
  report_id uuid primary key references reports(id) on delete cascade,
  notion_page_id text unique,
  notion_page_url text,
  notion_status delivery_status not null default 'pending',
  notion_last_error text,
  slack_channel_id text,
  slack_message_ts text,
  slack_permalink text,
  slack_status delivery_status not null default 'pending',
  slack_last_error text,
  updated_at timestamptz not null default now()
);

create table if not exists outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id) on delete cascade,
  target delivery_target not null,
  action text not null,
  report_version integer not null,
  dedupe_key text not null unique,
  status delivery_status not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists idempotency_keys (
  member_id uuid not null references members(id) on delete cascade,
  operation text not null,
  key text not null,
  response_status integer not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (member_id, operation, key)
);

create index if not exists reports_date_idx on reports (report_date desc, id desc);
create index if not exists reports_author_idx on reports (author_id, report_date desc);
create index if not exists reports_tags_gin_idx on reports using gin (theme_tags);
create index if not exists reports_search_trgm_idx on reports using gin (
  (coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(activity_text, '') || ' ' || coalesce(learning_text, '') || ' ' || coalesce(issue_text, '') || ' ' || coalesce(next_action_text, '')) gin_trgm_ops
);
create index if not exists outbox_available_idx on outbox_jobs (status, available_at);

-- The application uses server-side PostgreSQL and service-role Storage access only.
-- Enabling RLS without browser policies prevents accidental exposure through PostgREST.
alter table members enable row level security;
alter table reports enable row level security;
alter table related_links enable row level security;
alter table attachments enable row level security;
alter table integration_bindings enable row level security;
alter table outbox_jobs enable row level security;
alter table idempotency_keys enable row level security;
