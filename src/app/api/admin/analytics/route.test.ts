import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ actor: vi.fn(), analytics: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireCurrentUser: mocks.actor }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/analytics", () => ({ getUsageAnalytics: mocks.analytics }));
import { GET } from "./route";
it("does not disclose access activity to ordinary members", async () => {
  mocks.actor.mockResolvedValue({ id: "user", role: "member" });
  expect((await GET(new Request("https://log.test/api/admin/analytics"))).status).toBe(403);
  expect(mocks.analytics).not.toHaveBeenCalled();
});
it("returns analytics to admins without caching", async () => {
  mocks.actor.mockResolvedValue({ id: "admin", role: "admin" });
  mocks.analytics.mockResolvedValue({ members: [], reports: [] });
  const response = await GET(new Request("https://log.test/api/admin/analytics"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
