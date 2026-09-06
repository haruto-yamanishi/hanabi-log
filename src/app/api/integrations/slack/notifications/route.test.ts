import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), history: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireCurrentUser: mocks.user }));
vi.mock("@/server/integrations/like-notification-history", () => ({ listLikeNotificationHistory: mocks.history }));
import { GET } from "./route";

beforeEach(() => vi.clearAllMocks());
it("does not expose DM history to members", async () => {
  mocks.user.mockResolvedValue({ role: "member" });
  expect((await GET()).status).toBe(403);
  expect(mocks.history).not.toHaveBeenCalled();
});
it("returns recorded DM history only to admins without shared caching", async () => {
  mocks.user.mockResolvedValue({ role: "admin" });
  const history = [{ recipientName: "送信時の名前", messageText: "送信された本文", status: "sent" }];
  mocks.history.mockResolvedValue(history);
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual(history);
});
