-- Upload finalization writes a server-owned JSON verification record beside the media.
-- Preserve the current size limit and existing allowed types.
update storage.buckets
set allowed_mime_types = array_append(allowed_mime_types, 'application/json')
where id = 'hanabi-log-private'
  and allowed_mime_types is not null
  and not ('application/json' = any(allowed_mime_types));
