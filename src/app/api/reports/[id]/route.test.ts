import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser, Report } from "@/lib/types";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  getReadableReport: vi.fn(),
  deleteReport: vi.fn(),
  deleteReportResources: vi.fn(),
  deleteReportAttachments: vi.fn(),
  patchReport: vi.fn(),
  after: vi.fn(),
  processReportJobs: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
}));

vi.mock("@/server/repositories", () => ({
  getReportRepository: () => ({
    getReadableReport: mocks.getReadableReport,
    deleteReport: mocks.deleteReport,
    patchReport: mocks.patchReport,
  }),
}));

vi.mock("@/server/reports/delete-report-resources", () => ({
  deleteReportResources: mocks.deleteReportResources,
}));

vi.mock("@/server/db/storage", () => ({ deleteReportAttachments: mocks.deleteReportAttachments, signReportAttachments: (report: Report) => report }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/server/integrations/outbox", () => ({ processReportJobs: mocks.processReportJobs }));

import { DELETE, PATCH } from "./route";

const admin: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_ADMIN",
  displayName: "Admin",
  role: "admin",
  isActive: true,
};
const report: Report = {
  id: "20000000-0000-4000-8000-000000000001",
  authorId: admin.id,
  author: { id: admin.id, displayName: admin.displayName },
  reportDate: "2026-08-20",
  title: "削除テスト",
  summary: "",
  activityArea: "ロボット",
  contentCategory: "進捗",
  activityText: "作業した。",
  learningText: "",
  issueText: "",
  nextActionText: "",
  themeTags: [],
  status: "published",
  version: 1,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  relatedLinks: [],
  attachments: [],
};

function context(id = report.id) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/reports/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue(admin);
    mocks.getReadableReport.mockResolvedValue(report);
    mocks.deleteReportResources.mockResolvedValue(undefined);
    mocks.deleteReport.mockResolvedValue(undefined);
  });

  it("lets an Admin remove provider resources before deleting the report", async () => {
    const response = await DELETE(
      new Request(`https://hanabi.example/api/reports/${report.id}`, { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(204);
    expect(mocks.deleteReportResources).toHaveBeenCalledWith(report);
    expect(mocks.deleteReport).toHaveBeenCalledWith(report.id, admin);
    expect(mocks.deleteReportResources.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteReport.mock.invocationCallOrder[0],
    );
  });

  it("rejects members deleting a published report", async () => {
    mocks.requireCurrentUser.mockResolvedValue({ ...admin, role: "member" });

    const response = await DELETE(
      new Request(`https://hanabi.example/api/reports/${report.id}`, { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(mocks.deleteReportResources).not.toHaveBeenCalled();
    expect(mocks.deleteReport).not.toHaveBeenCalled();
  });

  it("keeps the database report when external cleanup fails", async () => {
    mocks.deleteReportResources.mockRejectedValue(new Error("Slack unavailable"));

    const response = await DELETE(
      new Request(`https://hanabi.example/api/reports/${report.id}`, { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(500);
    expect(mocks.deleteReport).not.toHaveBeenCalled();
  });
});


describe("draft deletion authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({ ...admin, role: "member" });
    mocks.getReadableReport.mockResolvedValue({ ...report, status: "draft" });
    mocks.deleteReport.mockResolvedValue(undefined);
    mocks.deleteReportAttachments.mockResolvedValue(undefined);
  });
  it("lets the owner delete a draft without Slack or Notion configuration", async () => {
    const response = await DELETE(new Request("https://hanabi.test", { method: "DELETE" }), context());
    expect(response.status).toBe(204);
    expect(mocks.deleteReport).toHaveBeenCalledWith(report.id, expect.objectContaining({ role: "member" }), report.version);
    expect(mocks.deleteReportAttachments).toHaveBeenCalledOnce();
    expect(mocks.deleteReportResources).not.toHaveBeenCalled();
  });
  it("rejects another member draft before removing any resources", async () => {
    mocks.getReadableReport.mockResolvedValue({ ...report, status: "draft", authorId: "another" });
    const response = await DELETE(new Request("https://hanabi.test", { method: "DELETE" }), context());
    expect(response.status).toBe(403);
    expect(mocks.deleteReport).not.toHaveBeenCalled();
    expect(mocks.deleteReportAttachments).not.toHaveBeenCalled();
  });
  it("does not remove images when a concurrent edit wins", async () => {
    const { AppError } = await import("@/server/errors");
    mocks.deleteReport.mockRejectedValueOnce(new AppError("CONFLICT", "updated", 409));
    const response = await DELETE(new Request("https://hanabi.test", { method: "DELETE" }), context());
    expect(response.status).toBe(409);
    expect(mocks.deleteReportAttachments).not.toHaveBeenCalled();
  });
});

describe("PATCH deferred delivery", () => {
  it("returns the saved report before a slow integration job finishes", async () => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue(admin);
    mocks.getReadableReport.mockResolvedValue(report);
    mocks.patchReport.mockResolvedValue({ ...report, version: 2 });
    let finish!: () => void;
    mocks.processReportJobs.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const response = await PATCH(new Request("https://hanabi.test", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, report: { reportDate: report.reportDate, title: report.title, activityArea: report.activityArea, contentCategory: report.contentCategory, activityText: report.activityText } }),
    }), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ version: 2, status: "published" });
    expect(mocks.processReportJobs).not.toHaveBeenCalled();
    const work = mocks.after.mock.calls[0][0]();
    expect(mocks.processReportJobs).toHaveBeenCalledWith(report.id);
    finish();
    await work;
  });
});
