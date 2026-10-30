import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ actor: vi.fn(), report: vi.fn(), setLike: vi.fn(), notify: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireCurrentUser: mocks.actor }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/repositories", () => ({ getReportRepository: () => ({ getReadableReport: mocks.report }) }));
vi.mock("@/server/integrations/comment-likes", () => ({ setCommentLike: mocks.setLike }));
vi.mock("@/server/integrations/like-notifications", () => ({ scheduleLikeNotifications: mocks.notify }));
import { PUT, DELETE } from "./route";
const context = { params: Promise.resolve({ id: "20000000-0000-4000-8000-000000000001", commentId: "1800000000.000001" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ id: "actor" });
  mocks.report.mockResolvedValue({ status: "published" });
  mocks.setLike.mockResolvedValue({ likeCount: 2, likedByCurrentUser: true });
});
it("requires access to the containing report", async () => {
  mocks.report.mockResolvedValue(null);
  expect((await PUT(new Request("https://log.test/comment/like"),context)).status).toBe(404);
  expect(mocks.setLike).not.toHaveBeenCalled();
});
it("uses an explicit idempotent like state and only notifies on additions", async () => {
  const request = new Request("https://log.test/comment/like");
  expect((await PUT(request,context)).status).toBe(200);
  expect(mocks.setLike).toHaveBeenLastCalledWith(expect.any(String),"1800000000.000001",{ id: "actor" },true);
  expect(mocks.notify).toHaveBeenCalledTimes(1);
  expect((await DELETE(request,context)).status).toBe(200);
  expect(mocks.setLike).toHaveBeenLastCalledWith(expect.any(String),"1800000000.000001",{ id: "actor" },false);
  expect(mocks.notify).toHaveBeenCalledTimes(1);
});
