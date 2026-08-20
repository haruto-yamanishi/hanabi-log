import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Member, Report } from "@/lib/types";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  getReadableReport: vi.fn(),
  listMembers: vi.fn(),
  list: vi.fn(),
  post: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ requireCurrentUser: mocks.requireCurrentUser }));
vi.mock("@/server/env", () => ({ env: { SLACK_BOT_TOKEN: "xoxb-test" } }));
vi.mock("@/server/repositories", () => ({
  getReportRepository: () => ({
    getReadableReport: mocks.getReadableReport,
    listMembers: mocks.listMembers,
  }),
}));
vi.mock("@/server/integrations/slack-comments", () => ({
  createSlackCommentService: () => ({ list: mocks.list, post: mocks.post }),
}));

import { GET, POST } from "./route";

const actor: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_ACTOR",
  displayName: "Hanabi member",
  role: "member",
  isActive: true,
};
const member: Member = {
  ...actor,
  slackTeamId: "T_TEAM",
  email: null,
  avatarUrl: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};
const report: Report = {
  id: "20000000-0000-4000-8000-000000000001",
  authorId: actor.id,
  author: { id: actor.id, slackUserId: actor.slackUserId, displayName: actor.displayName },
  reportDate: "2026-08-20",
  title: "コメント同期",
  summary: "Slackと同期する",
  activityArea: "チーム運営",
  contentCategory: "進捗",
  activityText: "コメント同期を実装した。",
  learningText: "",
  issueText: "",
  nextActionText: "",
  themeTags: [],
  status: "published",
  version: 1,
  publishedAt: "2026-08-20T00:00:00.000Z",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  relatedLinks: [],
  attachments: [],
  integration: {
    reportId: "20000000-0000-4000-8000-000000000001",
    slackChannelId: "C_REPORTS",
    slackMessageTs: "1787200000.000100",
    slackStatus: "delivered",
    notionStatus: "delivered",
    updatedAt: "2026-08-20T00:00:00.000Z",
  },
};
const context = { params: Promise.resolve({ id: report.id }) };

describe("/api/reports/[id]/comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue(actor);
    mocks.getReadableReport.mockResolvedValue(report);
    mocks.listMembers.mockResolvedValue([member]);
    mocks.list.mockResolvedValue([]);
    mocks.post.mockResolvedValue({
      id: "1787200100.000200",
      body: "確認しました",
      createdAt: "2026-08-20T00:01:40.000Z",
      source: "web",
      author: { id: actor.id, displayName: actor.displayName, avatarUrl: null },
    });
  });

  it("returns replies from the bound Slack thread", async () => {
    const response = await GET(
      new Request(`https://hanabi.test/api/reports/${report.id}/comments`),
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ available: true, comments: [] });
    expect(mocks.list).toHaveBeenCalledWith({
      channel: "C_REPORTS",
      threadTs: "1787200000.000100",
      members: [member],
    });
  });

  it("returns an unavailable state while Slack delivery is pending", async () => {
    mocks.getReadableReport.mockResolvedValue({ ...report, integration: null });

    const response = await GET(
      new Request(`https://hanabi.test/api/reports/${report.id}/comments`),
      context,
    );

    await expect(response.json()).resolves.toEqual({ available: false, comments: [] });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("posts a WEB comment to the same Slack thread", async () => {
    const response = await POST(
      new Request(`https://hanabi.test/api/reports/${report.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "  確認しました  " }),
      }),
      context,
    );

    expect(response.status).toBe(201);
    expect(mocks.post).toHaveBeenCalledWith({
      channel: "C_REPORTS",
      threadTs: "1787200000.000100",
      actor,
      body: "確認しました",
    });
  });

  it("rejects empty comments", async () => {
    const response = await POST(
      new Request(`https://hanabi.test/api/reports/${report.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "   " }),
      }),
      context,
    );

    expect(response.status).toBe(422);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("does not allow comments on an archived report", async () => {
    mocks.getReadableReport.mockResolvedValue({ ...report, status: "archived" });

    const response = await POST(
      new Request(`https://hanabi.test/api/reports/${report.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "コメント" }),
      }),
      context,
    );

    expect(response.status).toBe(409);
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
