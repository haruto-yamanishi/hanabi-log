-- Preserve an explicit failure instead of silently marking missing threads imported.
alter table integration_bindings add column slack_thread_reactions_error text;
