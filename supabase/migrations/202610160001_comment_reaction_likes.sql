-- Keep original message IDs for emoji tombstones, and separately identify the report thread.
alter table slack_report_reactions add column slack_thread_ts text;
alter table slack_report_reactions add column resolve_after timestamptz not null default now();
create index slack_report_reactions_thread_idx
  on slack_report_reactions (channel_id, slack_thread_ts, user_id);
create index slack_report_reactions_unresolved_idx
  on slack_report_reactions (resolve_after) where slack_thread_ts is null and processed_at is null;

update slack_report_reactions reaction set slack_thread_ts = reaction.message_ts
from integration_bindings binding
where binding.slack_channel_id = reaction.channel_id and binding.slack_message_ts = reaction.message_ts;

-- A new marker lets reports whose parent reactions were already imported be backfilled again.
-- Cursor checkpoints keep long threads resumable within the API route timeout.
alter table integration_bindings add column slack_thread_reactions_imported_at timestamptz;
alter table integration_bindings add column slack_thread_reactions_cursor text;
