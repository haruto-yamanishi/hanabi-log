import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDatabase: () => vi.fn().mockResolvedValue([]) }));
vi.mock("@/server/env", () => ({ env: { SLACK_TEAM_ID: "T1" } }));
import { createSlackMentionResolver, normalizeImportedMentions } from "./slack-mention-names";
import type { WebClient } from "@slack/web-api";
import { displayMentions, generateSummary } from "@/lib/text";
describe("Slack mention names", () => {
  it("preserves identities while showing user and group names", async () => {
    const resolve = vi.fn(async (id: string) => ({U123:"太郎",S123:"開発チーム"})[id as 'U123'] ?? null);
    const text = await normalizeImportedMentions("<@U123>と<@U123|old> <!subteam^S123|old> <https://example.com|link>",resolve);
    expect(text).toBe("@[太郎](slack:U123)と@[太郎](slack:U123) @[開発チーム](slack:S123) <https://example.com|link>");
    expect(displayMentions(text)).toContain("@太郎と@太郎 @開発チーム");
    expect(generateSummary(text)).toBe("@太郎と@太郎 @開発チーム");
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it("retains unresolved IDs, uses provided labels, and prevents malformed tokens", async () => {
    expect(await normalizeImportedMentions("<@U1> <@W2|@名前]改行\n> <!subteam^S1|@team>",async()=>null))
      .toBe("<@U1> @[名前 改行](slack:W2) @[team](slack:S1)");
  });
  it("resolves Slack-only users and caches API lookups", async () => {
    const info = vi.fn().mockResolvedValue({user:{profile:{display_name:"Slackの名前"}}});
    const list = vi.fn().mockResolvedValue({usergroups:[{id:"S1",name:"グループ"}]});
    const resolve = createSlackMentionResolver({users:{info},usergroups:{list}} as unknown as WebClient);
    expect(await resolve("U1")).toBe("Slackの名前");
    expect(await resolve("U1")).toBe("Slackの名前");
    expect(await resolve("S1")).toBe("グループ");
    expect(await resolve("S2")).toBeNull();
    expect(info).toHaveBeenCalledTimes(1); expect(list).toHaveBeenCalledTimes(1);
  });
});
