import { WebClient } from "@slack/web-api";
import { getDatabase } from "../src/server/db/client";
import { env, isDemoMode } from "../src/server/env";
import { displayMentions } from "../src/lib/text";
import { createSlackMentionResolver, normalizeImportedMentions } from "../src/server/integrations/slack-mention-names";
const sql = getDatabase();
try {
  if (isDemoMode || !env.SLACK_BOT_TOKEN) throw new Error("Live Slack configuration required");
  const apply = process.argv.includes("--apply");
  const resolve = createSlackMentionResolver(new WebClient(env.SLACK_BOT_TOKEN, { retryConfig: { retries: 0 }, rejectRateLimitedCalls: true, timeout: 10000 }));
  const stats = { apply, historyNames: 0, reports: 0, unresolvedNames: 0, conflicts: 0 };
  const history = await sql`select distinct recipient_slack_user_id as id from system_dm_deliveries
    where recipient_name=recipient_slack_user_id or trim(recipient_name)=''`;
  for (const row of history) {
    const name = await resolve(row.id);
    if (!name) { stats.unresolvedNames++; continue; }
    if (apply) await sql`update system_dm_deliveries set recipient_name=${name}
      where recipient_slack_user_id=${row.id} and (recipient_name=recipient_slack_user_id or trim(recipient_name)='')`;
    stats.historyNames++;
  }
  const rows = await sql`select r.*, b.slack_source_message from reports r left join integration_bindings b on b.report_id=r.id
    where concat_ws(' ',r.title,r.summary,r.activity_text,r.learning_text,r.issue_text,r.next_action_text) ~ '<(@[UW]|!subteam\\^S)'`;
  for (const row of rows) {
    const fields = ['title','summary','activity_text','learning_text','issue_text','next_action_text'] as const;
    const updated: Record<string,string|null> = {};
    for (const field of fields) updated[field] = row[field] == null ? null : await normalizeImportedMentions(row[field],resolve);
    // Imported summaries were truncated raw Slack text; rebuild only untouched generated summaries.
    if (row.slack_source_message && row.summary === Array.from(row.activity_text as string).slice(0,100).join('')) {
      updated.summary = Array.from(displayMentions(updated.activity_text!)).slice(0,100).join('');
    } else if (updated.summary) updated.summary = Array.from(displayMentions(updated.summary)).slice(0,100).join('');
    if (updated.title) updated.title = Array.from(displayMentions(updated.title)).slice(0,60).join('');
    if (!fields.some(field=>updated[field]!==row[field])) continue;
    const [identities] = await sql`select
      array(select target_id from report_mention_targets(${fields.map(field=>row[field] ?? '').join('\n')}) order by target_id) as before,
      array(select target_id from report_mention_targets(${fields.map(field=>updated[field] ?? '').join('\n')}) order by target_id) as after`;
    if (JSON.stringify(identities.before)!==JSON.stringify(identities.after)) throw new Error("Mention identities changed; repair stopped");
    if (apply) await sql.begin(async tx=>{
      const [saved] = await tx`update reports set ${tx(updated)},version=version+1,updated_at=now()
        where id=${row.id} and version=${row.version} returning version,status`;
      if (!saved) { stats.conflicts++; return; }
      if (['published','archived'].includes(saved.status)) {
        await tx`insert into outbox_jobs(report_id,target,action,report_version,dedupe_key)
          values(${row.id},'notion','update',${saved.version},${`${row.id}:notion:update:${saved.version}`}) on conflict do nothing`;
        await tx`update integration_bindings set notion_status='pending',notion_last_error=null where report_id=${row.id}`;
      }
    });
    stats.reports++;
  }
  console.log(JSON.stringify(stats));
} finally { await sql.end(); }
