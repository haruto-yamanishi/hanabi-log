import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/types";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  setReportLike: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
}));

vi.mock("@/server/repositories", () => ({
  getReportRepository: () => ({ setReportLike: mocks.setReportLike }),
}));

import { DELETE, PUT } from "./route";

const user: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_TEST",
  displayName: "Test member",
  role: "member",
  isActive: true,
};
const reportId = "20000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: reportId }) };

describe("/api/reports/[id]/like", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue(user);
  });

  it("adds a like idempotently", async () => {
    mocks.setReportLike.mockResolvedValue({
      likeCount: 3,
      liked: true,
      likedBy: [{ id: user.id, displayName: user.displayName, avatarUrl: null }],
    });
    const response = await PUT(new Request(`https://hanabi.test/api/reports/${reportId}/like`), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      likeCount: 3,
      liked: true,
      likedBy: [{ id: user.id, displayName: user.displayName, avatarUrl: null }],
    });
    expect(mocks.setReportLike).toHaveBeenCalledWith(reportId, user, true);
  });

  it("removes the current member's like", async () => {
    mocks.setReportLike.mockResolvedValue({ likeCount: 2, liked: false, likedBy: [] });
    const response = await DELETE(new Request(`https://hanabi.test/api/reports/${reportId}/like`), context);
    expect(response.status).toBe(200);
    expect(mocks.setReportLike).toHaveBeenCalledWith(reportId, user, false);
  });
});
