import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
const state=vi.hoisted(() => ({sql:undefined as unknown,messages:[] as {text:string;ts:string;bot_id:string}[],post:vi.fn(),history:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/server/db/client",()=>({getDatabase:()=>state.sql}));
vi.mock("@/server/env",()=>({isDemoMode:false,env:{SLACK_BOT_TOKEN:"test"}}));
vi.mock("@slack/web-api",()=>({WebClient:class {
 chat={postMessage:state.post};
 conversations={history:state.history,replies:async()=>({messages:state.messages})};
}}));
import { bingoAnnouncement, isBingoAnnouncement, normalizeBingoSlackText, processBingoNotifications } from "./halloween-bingo";
const url=process.env.BINGO_TEST_DATABASE_URL;
describe.skipIf(!url)("Halloween participation and notifications",()=>{
 let sql:ReturnType<typeof postgres>;
 const member="00000000-0000-4000-8000-000000000001";
 const other="00000000-0000-4000-8000-000000000002";
 async function report(author:string,published:string,status="published") {
  await sql`insert into reports(id,author_id,published_at,status) values(gen_random_uuid(),${author},${published},${status})`;
 }
 beforeAll(async()=>{
  if(new URL(url!).hostname!=="127.0.0.1") throw new Error("Dedicated local DB required");
  sql=postgres(url!,{max:4});state.sql=sql;
  await sql`create table members(id uuid primary key,display_name text,slack_user_id text)`;
  await sql`create table reports(id uuid primary key,author_id uuid,published_at timestamptz,status text)`;
  await sql`insert into members values(${member},'First','U1'),(${other},'Second','U2')`;
  await report(member,"2026-10-30T00:00:00Z");
  await sql.unsafe(await readFile("supabase/migrations/202610300001_halloween_bingo.sql","utf8"));
  state.history.mockResolvedValue({messages:[{text:bingoAnnouncement.replace("https://log.9494hanabi.com/?bingo=1", "<https://log.9494hanabi.com/?bingo=1>"),ts:"100",bot_id:"B1"}]});
  state.post.mockImplementation(async({text}:{text:string})=>{
   const message={text,ts:String(101+state.messages.length),bot_id:"B1"};state.messages.push(message);return message;
  });
 });
 afterAll(async()=>{if(sql) await sql.end();});
 it("backfills existing entries, ignores drafts and exact boundaries",async()=>{
  expect((await sql`select * from halloween_bingo_entries`).length).toBe(1);
  await report(other,"2026-10-29T17:42:32.753Z");
  await report(other,"2026-11-06T10:00:00Z");
  await report(other,"2026-10-31T00:00:00Z","draft");
  await report("d5160b27-186c-45bd-84ec-71704239f44b","2026-10-31T00:00:00Z");
  expect((await sql`select * from halloween_bingo_entries`).length).toBe(1);
  await report(other,"2026-11-06T09:59:59Z");await report(other,"2026-11-05T00:00:00Z");
  expect((await sql`select * from halloween_bingo_entries`).length).toBe(2);
 });
 it("waits until announcement and sends each person once under concurrent calls",async()=>{
  await sql`update halloween_bingo_campaign set channel_id='C1',announce_at=now()+interval '1 day'`;
  await processBingoNotifications();expect(state.post).not.toHaveBeenCalled();
  await sql`update halloween_bingo_campaign set announce_at=now()-interval '1 minute'`;
  await Promise.all([processBingoNotifications(),processBingoNotifications()]);
  await processBingoNotifications();expect(state.post).toHaveBeenCalledTimes(2);
 });
 it("recovers accepted Slack messages even if database confirmation was lost",async()=>{
  state.post.mockClear();
  await sql`update halloween_bingo_entries set notified_ts=null`;
  await processBingoNotifications();expect(state.post).not.toHaveBeenCalled();
  expect((await sql`select * from halloween_bingo_entries where notified_ts is null`).length).toBe(0);
 });
});

 it("recognizes Slack-normalized announcement and notification emoji", () => {
  expect(isBingoAnnouncement(bingoAnnouncement.replaceAll("🎃", ":jack_o_lantern:"))).toBe(true);
  expect(isBingoAnnouncement("unrelated bot message")).toBe(false);
  expect(normalizeBingoSlackText(":jack_o_lantern: <@U1> 日報ありがとう！")).toBe("🎃 <@U1> 日報ありがとう！");
 });
