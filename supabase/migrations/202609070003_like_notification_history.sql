alter table report_like_notifications
  add column recipient_slack_user_id text,
  add column recipient_name text,
  add column message_text text,
  add column delivery_threshold integer,
  add column slack_channel_id text,
  add column slack_message_ts text;
-- Previously sent messages have no recorded body. Do not reconstruct historical
-- content using a title or display name that may have changed since delivery.
