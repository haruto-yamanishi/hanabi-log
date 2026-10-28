import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sql: undefined as unknown, post: vi.fn(), groups: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDatabase: () => state.sql }));
vi.mock("@/server/env", () => ({ isDemoMode: false, env: { SLACK_BOT_TOKEN: "test", SLACK_TEAM_ID: "T1", APP_BASE_URL: "https://hanabi.test" } }));
vi.mock("@slack/web-api", () => ({ WebClient: class {
  chat = { postMessage: state.post };
  users = { info: async ({user}: {user:string}) => ({user: {profile: {display_name: `名前 ${user}`}}}) };
  usergroups = { users: { list: state.groups } };
} }));
import { processMentionNotifications } from "./mention-notifications";

// Dedicated empty local DB; never use application credentials.
const url = process.env.MENTION_TEST_DATABASE_URL;
describe.skipIf(!url)("durable mention DMs", () => {
  let sql: ReturnType<typeof postgres>;
  let author: string;
  beforeAll(async () => {
    if (!["localhost", "127.0.0.1"].includes(new URL(url!).hostname)) throw new Error("Local DB required");
    sql = postgres(url!, { max: 4 }); state.sql = sql;
    await sql`do $$ begin
      if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $$`;
    for (const name of ["202608190001_hanabi_log", "202608200006_member_activity_and_report_approval", "202610170002_system_dm_deliveries"]) {
      await sql.unsafe(await readFile(`supabase/migrations/${name}.sql`, "utf8"));
    }
    await sql`alter table system_dm_deliveries add column blocks jsonb not null default '[]'`;
    const [member] = await sql`insert into members(slack_team_id,slack_user_id,display_name) values('T1','U1','Author') returning id`;
    author = member.id;
    await sql`insert into reports(author_id,report_date,title,activity_area,content_category,activity_text,status)
      values(${author},current_date,'Existing','ロボット','進捗','<@U2>','published')`;
    await sql`insert into integration_bindings(report_id,slack_channel_id,slack_message_ts) select id,'C123','123.456' from reports`;
    await sql.unsafe(await readFile("supabase/migrations/202610280001_mention_notifications.sql", "utf8"));
    state.post.mockResolvedValue({ channel: "D1", ts: "123.456" });
    state.groups.mockResolvedValue({ users: ["U2", "U3"] });
  });
  afterAll(async () => { if (sql) await sql.end(); });
  it("backfills only public reports and sends existing mentions once", async () => {
    expect((await processMentionNotifications()).delivered).toBe(1);
    await processMentionNotifications(); expect(state.post).toHaveBeenCalledTimes(1);
    const [history] = await sql`select recipient_name from system_dm_deliveries where recipient_slack_user_id='U2'`;
    expect(history.recipient_name).toBe("名前 U2");
    expect(state.post.mock.calls.at(-1)?.[0].text).toContain("https://app.slack.com/archives/C123/p123456?thread_ts=123.456&cid=C123");
    expect(state.post).toHaveBeenLastCalledWith(expect.objectContaining({channel:"U2",text:expect.stringContaining("あなたがメンションされています")}));
  });
  it("parses individual/group tokens and native Slack mentions, ignoring plain names", async () => {
    const rows = await sql`select * from report_mention_targets(${"@[名前](slack:U2) @[グループ](slack:S1) <@W4|Name> <!subteam^S2|team> @name @[bad](slack:X1)"}) order by target_id`;
    expect(rows.map(r => r.target_id)).toEqual(["S1", "S2", "U2", "W4"]);
  });
  it("queues on approval, deduplicates across fields/groups and preserves newly added mentions", async () => {
    const [r] = await sql`insert into reports(author_id,report_date,title,activity_area,content_category,activity_text,summary,status)
      values(${author},current_date,'New','ロボット','進捗','@[Person](slack:U2) @[Team](slack:S1)','@[Person](slack:U2)','pending_approval') returning id`;
    expect((await sql`select * from report_mention_notifications where report_id=${r.id}`).length).toBe(0);
    await sql`update reports set status='published' where id=${r.id}`;
    expect((await processMentionNotifications(r.id)).claimed).toBe(0);
    const [pending] = await sql`select attempts from report_mention_notifications where report_id=${r.id} limit 1`;
    expect(pending.attempts).toBe(0);
    await sql`insert into integration_bindings(report_id,slack_channel_id,slack_message_ts) values(${r.id},'C123','234.567')`;
    state.post.mockClear();
    await Promise.all([processMentionNotifications(r.id), processMentionNotifications(r.id)]);
    // Individual and group jobs may race; one retries after the shared dedupe claim.
    await sql`update report_mention_notifications set available_at=now() where report_id=${r.id}`;
    await processMentionNotifications(r.id);
    expect(state.post).toHaveBeenCalledTimes(2);
    expect(state.groups).toHaveBeenCalledTimes(1);
    await sql`update reports set activity_text='removed' where id=${r.id}`;
    await sql`update reports set activity_text='@[Again](slack:U2) <@U4>' where id=${r.id}`;
    await processMentionNotifications(r.id);
    expect(state.post).toHaveBeenCalledTimes(3);
    expect(state.post).toHaveBeenLastCalledWith(expect.objectContaining({channel:"U4"}));
  });
  it("retries failures, excludes archived reports and does not resend successful DMs", async () => {
    const [r] = await sql`insert into reports(author_id,report_date,title,activity_area,content_category,activity_text,status)
      values(${author},current_date,'Retry','ロボット','進捗','<@U5>','published') returning id`;
    await sql`insert into integration_bindings(report_id,slack_channel_id,slack_message_ts) values(${r.id},'C123','345.678')`;
    state.post.mockClear(); state.post.mockRejectedValueOnce(new Error("rate limited"));
    expect((await processMentionNotifications(r.id)).failed).toBe(1);
    expect((await processMentionNotifications(r.id)).claimed).toBe(0);
    await sql`update report_mention_notifications set available_at=now() where report_id=${r.id}`;
    await sql`update reports set status='archived' where id=${r.id}`;
    expect((await processMentionNotifications(r.id)).claimed).toBe(0);
    await sql`update reports set status='published' where id=${r.id}`;
    expect((await processMentionNotifications(r.id)).delivered).toBe(1);
    await processMentionNotifications(r.id);
    expect(state.post).toHaveBeenCalledTimes(2);
  });
});
