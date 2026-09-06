create table if not exists api_rate_limit_windows (
  bucket text not null,
  key_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (bucket, key_hash, window_start),
  constraint api_rate_limit_request_count_nonnegative check (request_count >= 0)
);

create index if not exists api_rate_limit_windows_cleanup_idx
  on api_rate_limit_windows (window_start);

alter table api_rate_limit_windows enable row level security;

-- The app accesses PostgreSQL only from the server. No browser/PostgREST policy is created.
-- Rate-limit rows contain only HMAC-derived identifiers; raw IP addresses are never persisted.
