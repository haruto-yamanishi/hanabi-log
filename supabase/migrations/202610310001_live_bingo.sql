-- Cards, draws and the public draw rule survive deploys and client reconnects.
create table if not exists bingo_games (
 id text primary key references halloween_bingo_campaign(id),
 status text not null default 'waiting' check (status in ('waiting','live','finished')),
 rule text not null default 'report-support' check (rule in ('uniform','report-support')),
 started_at timestamptz, started_by uuid references members(id),
 finished_at timestamptz, finished_by uuid references members(id)
);
insert into bingo_games(id) values ('2026') on conflict do nothing;
create table if not exists bingo_cards (
 game_id text not null references bingo_games(id),
 member_id uuid not null references members(id),
 cells integer[] not null check (array_length(cells,1)=25 and cells[13]=0),
 report_count integer not null default 0 check (report_count >= 0),
 created_at timestamptz not null default now(),
 primary key(game_id,member_id)
);
create table if not exists bingo_draws (
 game_id text not null references bingo_games(id),
 sequence integer not null check (sequence between 1 and 75),
 number integer not null check (number between 1 and 75),
 request_id uuid not null,
 drawn_by uuid not null references members(id),
 animation_at timestamptz not null,
 reveal_at timestamptz not null check (reveal_at > animation_at),
 weights jsonb not null,
 primary key(game_id,sequence),
 unique(game_id,number), unique(game_id,request_id)
);
alter table bingo_games enable row level security;
alter table bingo_cards enable row level security;
alter table bingo_draws enable row level security;
