import { describe, expect, it, vi } from "vitest";
import type { Report } from "@/lib/types";

vi.mock("server-only", () => ({}));

import {
  deleteReportResources,
  type ReportDeletionDependencies,
} from "@/server/reports/delete-report-resources";

const report: Report = {
  id: "report-1",
  authorId: "member-1",
  author: { id: "member-1", displayName: "Hanabi" },
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
  integration: {
    reportId: "report-1",
    slackChannelId: "C1",
    slackMessageTs: "1.1",
    slackStatus: "delivered",
    notionPageId: "page-1",
    notionStatus: "delivered",
    updatedAt: "2026-08-20T00:00:00.000Z",
  },
};

describe("deleteReportResources", () => {
  it("removes Slack, Notion, and attachments in a retry-safe order", async () => {
    const calls: string[] = [];
    const dependencies: ReportDeletionDependencies = {
      slack: { remove: vi.fn(async () => { calls.push("slack"); }) },
      notion: { remove: vi.fn(async () => { calls.push("notion"); }) },
      attachments: { remove: vi.fn(async () => { calls.push("attachments"); }) },
    };

    await deleteReportResources(report, dependencies);

    expect(calls).toEqual(["slack", "notion", "attachments"]);
    expect(dependencies.slack.remove).toHaveBeenCalledWith(report.integration);
    expect(dependencies.notion.remove).toHaveBeenCalledWith(report.integration);
    expect(dependencies.attachments.remove).toHaveBeenCalledWith(report);
  });
});
