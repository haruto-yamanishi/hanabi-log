import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Member } from "@/lib/types";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  setMemberRole: vi.fn(),
  setMemberActivity: vi.fn(),
  getMember: vi.fn(),
  deleteMember: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
}));

vi.mock("@/server/repositories", () => ({
  getReportRepository: () => ({
    setMemberRole: mocks.setMemberRole,
    setMemberActivity: mocks.setMemberActivity,
    getMember: mocks.getMember,
    deleteMember: mocks.deleteMember,
  }),
}));

import { DELETE, PATCH } from "./route";

const admin: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_ADMIN",
  displayName: "Admin",
  role: "admin",
  isActive: true,
};
const target: Member = {
  id: "20000000-0000-4000-8000-000000000001",
  slackTeamId: "T_PRIVATE",
  slackUserId: "U_PRIVATE",
  displayName: "Hanabi Member",
  email: "private@example.com",
  avatarUrl: null,
  role: "admin",
  isActive: true,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

function request(role: "member" | "admin"): Request {
  return new Request(`https://hanabi.example/api/members/${target.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
}

function invalidRoleRequest(): Request {
  return new Request(`https://hanabi.example/api/members/${target.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "owner" }),
  });
}

function activityRequest(isActive: boolean): Request {
  return new Request(`https://hanabi.example/api/members/${target.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isActive }),
  });
}

function context(id = target.id) {
  return { params: Promise.resolve({ id }) };
}

describe("PATCH /api/members/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue(admin);
    mocks.setMemberRole.mockResolvedValue(target);
    mocks.getMember.mockResolvedValue({ ...target, role: "member" });
    mocks.setMemberActivity.mockResolvedValue({ ...target, role: "member", isActive: false });
  });

  it("lets an Admin change another member and returns only public fields", async () => {
    const response = await PATCH(request("admin"), context());

    expect(response.status).toBe(200);
    expect(mocks.setMemberRole).toHaveBeenCalledWith(target.id, "admin");
    await expect(response.json()).resolves.toEqual({
      id: target.id,
      displayName: target.displayName,
      avatarUrl: null,
      role: "admin",
      isActive: true,
    });
  });

  it("lets an Admin mark another Member as Inactive", async () => {
    const response = await PATCH(activityRequest(false), context());

    expect(response.status).toBe(200);
    expect(mocks.setMemberActivity).toHaveBeenCalledWith(target.id, false);
    await expect(response.json()).resolves.toMatchObject({
      id: target.id,
      role: "member",
      isActive: false,
    });
  });

  it("prevents self-deactivation and Admin deactivation", async () => {
    const self = await PATCH(activityRequest(false), context(admin.id));
    expect(self.status).toBe(409);
    await expect(self.json()).resolves.toMatchObject({
      error: { code: "SELF_DEACTIVATION_FORBIDDEN" },
    });

    mocks.getMember.mockResolvedValue(target);
    const targetAdmin = await PATCH(activityRequest(false), context());
    expect(targetAdmin.status).toBe(409);
    await expect(targetAdmin.json()).resolves.toMatchObject({
      error: { code: "ADMIN_DEACTIVATION_FORBIDDEN" },
    });
  });

  it("rejects changes from a Member", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ ...admin, role: "member" });

    const response = await PATCH(request("admin"), context());

    expect(response.status).toBe(403);
    expect(mocks.setMemberRole).not.toHaveBeenCalled();
  });

  it("prevents an Admin from demoting their own account", async () => {
    const response = await PATCH(request("member"), context(admin.id));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SELF_DEMOTION_FORBIDDEN" },
    });
    expect(mocks.setMemberRole).not.toHaveBeenCalled();
  });

  it("returns 404 when the target member does not exist", async () => {
    mocks.setMemberRole.mockResolvedValue(null);

    const response = await PATCH(request("member"), context());

    expect(response.status).toBe(404);
  });

  it("accepts only member and admin roles", async () => {
    const response = await PATCH(invalidRoleRequest(), context());

    expect(response.status).toBe(422);
    expect(mocks.setMemberRole).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/members/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue(admin);
    mocks.deleteMember.mockResolvedValue("deleted");
  });

  it("lets an Admin delete another member without reports", async () => {
    const response = await DELETE(
      new Request(`https://hanabi.example/api/members/${target.id}`, { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(204);
    expect(mocks.deleteMember).toHaveBeenCalledWith(target.id);
  });

  it("rejects deletion from a Member", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ ...admin, role: "member" });

    const response = await DELETE(request("member"), context());

    expect(response.status).toBe(403);
    expect(mocks.deleteMember).not.toHaveBeenCalled();
  });

  it("prevents an Admin from deleting their own account", async () => {
    const response = await DELETE(request("member"), context(admin.id));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "SELF_DELETE_FORBIDDEN" },
    });
    expect(mocks.deleteMember).not.toHaveBeenCalled();
  });

  it("preserves a member who has authored reports", async () => {
    mocks.deleteMember.mockResolvedValue("has_reports");

    const response = await DELETE(request("member"), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MEMBER_HAS_REPORTS" },
    });
  });

  it("returns 404 when the member does not exist", async () => {
    mocks.deleteMember.mockResolvedValue("not_found");

    const response = await DELETE(request("member"), context());

    expect(response.status).toBe(404);
  });
});
