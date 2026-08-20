create index if not exists reports_pending_approval_idx
  on reports (status, updated_at desc)
  where status = 'pending_approval';
