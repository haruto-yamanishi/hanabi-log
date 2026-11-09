import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ actor: vi.fn(), report: vi.fn(), replies: vi.fn(), info: vi.fn(), fetch: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireCurrentUser: mocks.actor }));
vi.mock("@/server/env", () => ({ env: { SLACK_BOT_TOKEN: "test-token" } }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/repositories", () => ({ getReportRepository: () => ({ getReadableReport: mocks.report }) }));
vi.mock("@/server/integrations/slack-comments", () => ({ SlackWebCommentAdapter: { fromToken: () => ({ listReplies: mocks.replies }) } }));
vi.mock("@slack/web-api", () => ({ WebClient: class { files = { info: mocks.info }; } }));
import { GET } from "./route";
const context = { params: Promise.resolve({ id: "20000000-0000-4000-8000-000000000001", fileId: "F123" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ id: "actor" });
  mocks.report.mockResolvedValue({ integration: { slackChannelId: "C1", slackMessageTs: "1.001" } });
  mocks.replies.mockResolvedValue([{ files: [{ id: "F123" }] }]);
  mocks.info.mockResolvedValue({ file: { url_private: "https://files.slack.com/private/video", mimetype: "video/mp4" } });
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());
it("does not fetch media for an unreadable report", async () => {
  mocks.report.mockResolvedValue(null);
  const result = await GET(new Request("https://log.test/video"), context);
  expect(result.status).toBe(404);
  expect(mocks.info).not.toHaveBeenCalled();
});
it("rejects a file that belongs to a different thread", async () => {
  mocks.replies.mockResolvedValue([{ files: [{ id: "FOTHER" }] }]);
  const result = await GET(new Request("https://log.test/video"), context);
  expect(result.status).toBe(404);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("streams byte ranges without exposing the Slack token", async () => {
  mocks.fetch.mockResolvedValue(new Response("video", { status: 206, headers: { "Content-Range": "bytes 0-4/100", "Accept-Ranges": "bytes" } }));
  const result = await GET(new Request("https://log.test/video", { headers: { Range: "bytes=0-4" } }), context);
  expect(result.status).toBe(206);
  expect(result.headers.get("content-range")).toBe("bytes 0-4/100");
  expect(result.headers.get("authorization")).toBeNull();
  expect(await result.text()).toBe("video");
  expect(mocks.fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ headers: { Authorization: "Bearer test-token", Range: "bytes=0-4" } }));
});
it("refuses redirects or URLs outside the Slack file host", async () => {
  mocks.info.mockResolvedValue({ file: { url_private: "https://other.test/file", mimetype: "video/mp4" } });
  expect((await GET(new Request("https://log.test/video"), context)).status).toBe(404);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
