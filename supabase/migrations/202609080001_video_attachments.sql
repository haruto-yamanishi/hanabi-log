-- Keep report media private; permit video uploads up to 50 MiB.
update storage.buckets
set file_size_limit = 52428800,
    allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm'
    ]
where id = 'hanabi-log-private';
