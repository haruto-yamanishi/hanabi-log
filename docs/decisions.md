# MVP implementation decisions

The product specification is the source of truth. The following narrow decisions resolve places where v0.2 does not define an implementation detail.

- Hosting uses Vercel and data uses Supabase, as selected by the specification. Firebase is not added as a second platform.
- Classification values remain code constants with matching PostgreSQL checks. The MVP admin page displays them but does not edit them.
- A draft must contain the four required fields because the supplied database schema marks them non-null/non-blank.
- The default archive search returns published reports. A status filter can include the current member's drafts or archived reports; admins can see every state.
- Admin bootstrap uses `ADMIN_SLACK_USER_IDS` only when a Slack member is first inserted. Admins can subsequently change roles in S07; existing sessions refresh the database role and self-demotion is rejected to prevent accidental lockout.
- Idempotency keys are persisted in a small supporting table, keyed by member, operation, and key.
- Integration jobs have four retry delays (1 minute, 5 minutes, 30 minutes, 2 hours); a job becomes dead after the fourth failed attempt.
- Archived Slack cards keep a link to the authenticated archive detail and are explicitly marked archived.
