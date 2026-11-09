import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ auth: vi.fn(), list: vi.fn() }));
vi.mock("@/server/auth", () => ({ requireCurrentUser: state.auth }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: vi.fn() }));
vi.mock("@/server/media-gallery", async original => ({ ...await original<typeof import("@/server/media-gallery")>(), listMedia: state.list }));
import { GET } from "./route";
import { AppError } from "@/server/errors";
beforeEach(() => { vi.clearAllMocks(); state.auth.mockResolvedValue({ id:"member" }); state.list.mockResolvedValue({items:[],nextCursor:null}); });
it("requires login before reading media", async () => {
  state.auth.mockRejectedValue(new AppError("UNAUTHORIZED","ログインが必要です",401));
  expect((await GET(new Request("http://localhost/api/media"))).status).toBe(401);
  expect(state.list).not.toHaveBeenCalled();
});
it("validates filters and keeps responses private", async () => {
  expect((await GET(new Request("http://localhost/api/media?kind=other"))).status).toBe(422);
  const response = await GET(new Request("http://localhost/api/media?kind=video&source=comment"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(state.list).toHaveBeenCalledWith({kind:"video",source:"comment"},{id:"member"});
});
