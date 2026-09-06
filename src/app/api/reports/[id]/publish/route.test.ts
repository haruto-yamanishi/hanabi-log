import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Report } from "@/lib/types";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  publishReport: vi.fn(),
  getReadableReport: vi.fn(),
  processReportJobs: vi.fn(),
  after: vi.fn(),
}));

vi.mock("@/server/auth", () => ({ requireCurrentUser: mocks.requireCurrentUser }));
vi.mock("@/server/repositories", () => ({
  getReportRepository: () => ({
    publishReport: mocks.publishReport,
    getReadableReport: mocks.getReadableReport,
  }),
}));
vi.mock("@/server/integrations/outbox", () => ({ processReportJobs: mocks.processReportJobs }));
vi.mock("@/server/db/storage", () => ({ signReportAttachments: (report: Report) => report }));

vi.mock("next/server", () => ({ after: mocks.after }));

import { POST } from "./route";

const user: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_TEST",
  displayName: "Inactive member",
  role: "member",
  isActive: false,
};
const pending: Report = {
  id: "20000000-0000-4000-8000-000000000001",
  authorId: user.id,
  author: { id: user.id, displayName: user.displayName },
  reportDate: "2026-08-20",
  title: "公開申請",
  summary: "承認待ちにする",
  activityArea: "その他",
  contentCategory: "成果",
  activityText: "公開を申請した。",
  learningText: "",
  issueText: "",
  nextActionText: "",
  themeTags: [],
  status: "pending_approval",
  version: 2,
  publishedAt: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  relatedLinks: [],
  attachments: [],
};

describe("POST /api/reports/:id/publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue(user);
    mocks.publishReport.mockResolvedValue(pending);
    mocks.getReadableReport.mockResolvedValue(pending);
  });

  it("does not start integrations while an Inactive member waits for approval", async () => {
    const response = await POST(
      new Request(`https://hanabi.test/api/reports/${pending.id}/publish`, { method: "POST" }),
      { params: Promise.resolve({ id: pending.id }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "pending_approval" });
    expect(mocks.publishReport).toHaveBeenCalledWith(pending.id, user, undefined);
    expect(mocks.processReportJobs).not.toHaveBeenCalled();
  });
});


it("returns publication before integrations run and keeps it when delivery fails", async () => {
  vi.clearAllMocks();
  mocks.requireCurrentUser.mockResolvedValue({ ...user, isActive: true });
  mocks.publishReport.mockResolvedValue({ ...pending, status: "published" });
  mocks.processReportJobs.mockRejectedValueOnce(new Error("provider unavailable"));
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    const response = await POST(new Request("https://hanabi.test", { method: "POST" }), { params: Promise.resolve({ id: pending.id }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "published" });
    expect(mocks.processReportJobs).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledOnce();
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(mocks.processReportJobs).toHaveBeenCalledWith(pending.id);
    expect(log).toHaveBeenCalledOnce();
  } finally { log.mockRestore(); }
});
