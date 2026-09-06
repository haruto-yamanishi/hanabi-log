-- Keep one counted row per member, while remembering each source independently.
alter table report_likes add column web_liked boolean not null default true;
alter table report_likes add column slack_liked boolean not null default false;

alter table slack_incoming_reports add column report_id uuid references reports(id) on delete set null;
alter table slack_incoming_reports add column event_ts numeric;
update slack_incoming_reports incoming set
  report_id = binding.report_id
from integration_bindings binding
where binding.slack_source_message
  and binding.slack_channel_id = incoming.channel_id
  and binding.slack_message_ts = incoming.message_ts;
update slack_incoming_reports set event_ts = message_ts::numeric;
alter table slack_incoming_reports alter column event_ts set not null;
-- Distinguishes a deleted imported report from a message not imported yet.
alter table slack_incoming_reports add column imported boolean not null default false;
update slack_incoming_reports set imported = true where processed_at is not null;

-- Latest state per emoji; removed reactions stay as tombstones against late retries.
create table slack_report_reactions (
  channel_id text not null,
  message_ts text not null,
  user_id text not null,
  reaction text not null,
  active boolean not null,
  event_ts numeric not null,
  processed_at timestamptz,
  primary key (channel_id, message_ts, user_id, reaction)
);
alter table slack_report_reactions enable row level security;
