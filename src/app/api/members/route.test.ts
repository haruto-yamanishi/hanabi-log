import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Member } from "@/lib/types";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  listMembers: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
}));

vi.mock("@/server/repositories", () => ({
  getReportRepository: () => ({ listMembers: mocks.listMembers }),
}));

import { GET } from "./route";

const actor: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_ACTOR",
  displayName: "Actor",
  role: "member",
};

const member: Member = {
  id: "20000000-0000-4000-8000-000000000001",
  slackTeamId: "T_PRIVATE",
  slackUserId: "U_PRIVATE",
  displayName: "Hanabi Member",
  email: "private@example.com",
  avatarUrl: "https://example.com/avatar.png",
  role: "member",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

describe("GET /api/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue(actor);
    mocks.listMembers.mockResolvedValue([member]);
  });

  it("returns all members through the public DTO", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual([
      {
        id: member.id,
        displayName: member.displayName,
        avatarUrl: member.avatarUrl,
        role: member.role,
      },
    ]);
  });
});
