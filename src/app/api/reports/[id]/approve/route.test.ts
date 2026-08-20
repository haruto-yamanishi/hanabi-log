import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Report } from "@/lib/types";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  approveReport: vi.fn(),
  getReadableReport: vi.fn(),
  processReportJobs: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ requireCurrentUser: mocks.requireCurrentUser }));
vi.mock("@/server/repositories", () => ({
  getReportRepository: () => ({
    approveReport: mocks.approveReport,
    getReadableReport: mocks.getReadableReport,
  }),
}));
vi.mock("@/server/integrations/outbox", () => ({ processReportJobs: mocks.processReportJobs }));
vi.mock("@/server/db/storage", () => ({ signReportAttachments: (report: Report) => report }));

import { POST } from "./route";

const admin: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_ADMIN",
  displayName: "Admin",
  role: "admin",
  isActive: true,
};
const approved = {
  id: "20000000-0000-4000-8000-000000000001",
  authorId: "30000000-0000-4000-8000-000000000001",
  author: { id: "30000000-0000-4000-8000-000000000001", displayName: "OB member" },
  reportDate: "2026-08-20",
  title: "承認対象",
  summary: "Adminが確認した",
  activityArea: "その他",
  contentCategory: "成果",
  activityText: "活動を記録した。",
  learningText: "",
  issueText: "",
  nextActionText: "",
  themeTags: [],
  status: "published",
  version: 3,
  publishedAt: "2026-08-20T01:00:00.000Z",
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T01:00:00.000Z",
  relatedLinks: [],
  attachments: [],
} satisfies Report;

describe("POST /api/reports/:id/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue(admin);
    mocks.approveReport.mockResolvedValue(approved);
    mocks.getReadableReport.mockResolvedValue(approved);
  });

  it("approves a pending report and starts Slack/Notion delivery", async () => {
    const response = await POST(
      new Request(`https://hanabi.test/api/reports/${approved.id}/approve`, { method: "POST" }),
      { params: Promise.resolve({ id: approved.id }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.approveReport).toHaveBeenCalledWith(approved.id, admin);
    expect(mocks.processReportJobs).toHaveBeenCalledWith(approved.id);
  });
});
