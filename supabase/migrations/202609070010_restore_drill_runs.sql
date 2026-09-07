create table if not exists restore_drill_runs (
  run_id text primary key,
  backup_id text,
  status text not null check (status in ('running', 'passed', 'failed')),
  source_commit_sha text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_code text,
  updated_at timestamptz not null default now()
);

create index if not exists restore_drill_runs_started_idx
  on restore_drill_runs (started_at desc);

alter table restore_drill_runs enable row level security;

-- Operational status only. Never store restored row contents, object names, credentials, or tokens here.
