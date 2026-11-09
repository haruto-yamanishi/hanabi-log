import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ users: vi.fn(), groups: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireCurrentUser: async () => ({ id: "actor" }) }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/env", () => ({ env: { SLACK_BOT_TOKEN: "test" } }));
vi.mock("@slack/web-api", () => ({ WebClient: class { users = { list: mocks.users }; usergroups = { list: mocks.groups }; } }));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.users.mockResolvedValue({ members: [{ id: "U1", name: "haruto", real_name: "山西 遥斗", profile: { display_name: "はる" } }, { id: "UBOT", is_bot: true }] });
  mocks.groups.mockResolvedValue({ usergroups: [{ id: "S1", name: "ロボット", handle: "robot", user_count: "5" }, { id: "S2", handle: "old", date_delete: 123 }] });
});
it("returns active users and groups with searchable handles and real names", async () => {
  const response = await GET(new Request("https://log.test/mentions"));
  expect(await response.json()).toEqual({ groupStatus: "available", members: [
    { id: "U1", kind: "user", name: "はる", realName: "山西 遥斗", username: "haruto" },
    { id: "S1", kind: "group", name: "ロボット", username: "robot", memberCount: 5 },
  ] });
});
it("preserves individual mentions and reports missing group permissions", async () => {
  mocks.groups.mockRejectedValue({ data: { error: "missing_scope" } });
  const response = await GET(new Request("https://log.test/mentions"));
  const body = await response.json();
  expect(body.groupStatus).toBe("missing_scope");
  expect(body.members).toHaveLength(1);
  expect(response.headers.get("cache-control")).toContain("max-age=0");
});
