import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ report: vi.fn(), record: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireCurrentUser: async () => ({ id: "actor" }) }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/repositories", () => ({ getReportRepository: () => ({ getReadableReport: mocks.report }) }));
vi.mock("@/server/analytics", () => ({ recordReportView: mocks.record }));
import { POST } from "./route";
const context = { params: Promise.resolve({ id: "20000000-0000-4000-8000-000000000001" }) };
function request(visitId = crypto.randomUUID()) { return new Request("https://log.test/views", { method: "POST", body: JSON.stringify({ visitId }) }); }
beforeEach(() => vi.clearAllMocks());
it("does not count inaccessible reports", async () => {
  mocks.report.mockResolvedValue(null);
  expect((await POST(request(), context)).status).toBe(404);
  expect(mocks.record).not.toHaveBeenCalled();
});
it("does not count drafts or malformed visits", async () => {
  mocks.report.mockResolvedValue({ status: "draft" });
  expect((await POST(request(), context)).status).toBe(204);
  expect((await POST(request("invalid"), context)).status).toBe(422);
  expect(mocks.record).not.toHaveBeenCalled();
});
it("records successful report views using the authenticated member", async () => {
  mocks.report.mockResolvedValue({ status: "published" });
  const visitId = crypto.randomUUID();
  expect((await POST(request(visitId), context)).status).toBe(204);
  expect(mocks.record).toHaveBeenCalledWith("20000000-0000-4000-8000-000000000001", "actor", visitId);
});
