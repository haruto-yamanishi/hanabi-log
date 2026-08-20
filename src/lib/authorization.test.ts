import { describe, expect, it } from "vitest";
import { canEditReport, canReadReport, canRestoreReport } from "@/lib/authorization";
import type { CurrentUser, Report } from "@/lib/types";

const member: CurrentUser = {
  id: "11111111-1111-4111-8111-111111111111",
  slackUserId: "U1",
  displayName: "Member",
  role: "member",
  isActive: true,
};
const admin: CurrentUser = { ...member, id: "22222222-2222-4222-8222-222222222222", role: "admin" };
const report = {
  id: "33333333-3333-4333-8333-333333333333",
  authorId: member.id,
  author: {} as Report["author"],
  reportDate: "2026-08-19",
  title: "test",
  summary: "test",
  activityArea: "ロボット",
  contentCategory: "進捗",
  activityText: "test",
  learningText: "",
  issueText: "",
  nextActionText: "",
  themeTags: [],
  status: "draft",
  version: 1,
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
  relatedLinks: [],
  attachments: [],
} satisfies Report;

describe("authorization", () => {
  it("hides another member's draft", () => {
    const other = { ...member, id: "44444444-4444-4444-8444-444444444444" };
    expect(canReadReport(other, report)).toBe(false);
  });

  it("hides another member's pending approval report", () => {
    const pending = { ...report, status: "pending_approval" as const };
    const other = { ...member, id: "44444444-4444-4444-8444-444444444444" };
    expect(canReadReport(other, pending)).toBe(false);
    expect(canReadReport(member, pending)).toBe(true);
    expect(canReadReport(admin, pending)).toBe(true);
  });

  it("hides another member's archived report but keeps the owner's access", () => {
    const archived = { ...report, status: "archived" as const };
    const other = { ...member, id: "44444444-4444-4444-8444-444444444444" };
    expect(canReadReport(other, archived)).toBe(false);
    expect(canReadReport(member, archived)).toBe(true);
  });

  it("lets admins edit any report", () => {
    expect(canEditReport(admin, report)).toBe(true);
  });

  it("reserves restore for admins", () => {
    const archived = { ...report, status: "archived" as const };
    expect(canRestoreReport(member, archived)).toBe(false);
    expect(canRestoreReport(admin, archived)).toBe(true);
  });
});
