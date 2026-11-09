import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ auth: vi.fn(), get: vi.fn(), act: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireCurrentUser: state.auth }));
vi.mock("@/server/bingo-game", () => ({ getBingoSnapshot: state.get, actOnBingo: state.act }));
vi.mock("@/server/env", () => ({ env: { APP_BASE_URL: "https://example.test" } }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
import { GET, POST } from "./route";
import { AppError } from "@/server/errors";
beforeEach(() => { vi.clearAllMocks(); state.auth.mockResolvedValue({ id: "viewer" }); state.get.mockResolvedValue({ draws: [] }); state.act.mockResolvedValue({ draws: [] }); });
const request = (body: unknown, origin = "https://example.test") => new Request("https://example.test/api/bingo", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
it("requires authentication and never caches individual cards", async () => {
  expect((await GET()).headers.get("cache-control")).toBe("private, no-store");
  state.auth.mockRejectedValue(new AppError("UNAUTHORIZED", "Login required", 401));
  expect((await GET()).status).toBe(401);
  expect((await POST(request({ action: "start", rule: "uniform" }))).status).toBe(401);
  expect(state.act).not.toHaveBeenCalled();
});
it("rejects cross-origin commands and client-selected numbers", async () => {
  expect((await POST(request({ action: "start", rule: "uniform" }, "https://evil.test"))).status).toBe(403);
  expect((await POST(request({ action: "draw", expectedSequence: 0, requestId: crypto.randomUUID(), number: 7 }))).status).toBe(422);
  expect(state.act).not.toHaveBeenCalled();
});
it("validates sequence and request IDs before calling the host-authorized service", async () => {
  expect((await POST(request({ action: "draw", expectedSequence: -1, requestId: "bad" }))).status).toBe(422);
  const action = { action: "draw", expectedSequence: 0, requestId: crypto.randomUUID() };
  expect((await POST(request(action))).status).toBe(200);
  expect(state.act).toHaveBeenCalledWith({ id: "viewer" }, action);
  state.act.mockRejectedValue(new AppError("FORBIDDEN", "Host only", 403));
  expect((await POST(request(action))).status).toBe(403);
});
