import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment, CurrentUser, ReportInput } from "@/lib/types";

const storageMocks = vi.hoisted(() => ({
  requireUploadVerification: vi.fn(),
  signReportAttachments: vi.fn(),
}));

vi.mock("@/server/db/storage", () => storageMocks);

import { assertFinalizedAttachments } from "./_shared";

const user: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_TEST",
  displayName: "Test member",
  role: "member",
  isActive: true,
};

const attachment: Attachment = {
  storagePath: `${user.id}/2026-09/10000000-0000-4000-8000-000000000010.png`,
  filename: "photo.png",
  mimeType: "image/png",
  sizeBytes: 128,
  altText: "",
  sortOrder: 0,
};

function inputWith(attachments: Attachment[]): ReportInput {
  return {
    reportDate: "2026-09-07",
    title: "Upload finalization",
    activityArea: "ロボット",
    contentCategory: "進捗",
    activityText: "Upload validation test",
    attachments,
  };
}

describe("assertFinalizedAttachments", () => {
  beforeEach(() => {
    storageMocks.requireUploadVerification.mockReset();
  });

  it("requires a reusable verification for every new attachment", async () => {
    storageMocks.requireUploadVerification.mockResolvedValue(undefined);

    await expect(assertFinalizedAttachments(user, inputWith([attachment]))).resolves.toBeUndefined();

    expect(storageMocks.requireUploadVerification).toHaveBeenCalledTimes(1);
    expect(storageMocks.requireUploadVerification).toHaveBeenCalledWith(user, attachment);
  });

  it("propagates an unfinalized upload rejection instead of finalizing during report save", async () => {
    storageMocks.requireUploadVerification.mockRejectedValue(
      Object.assign(new Error("not finalized"), { code: "UPLOAD_NOT_FINALIZED" }),
    );

    await expect(assertFinalizedAttachments(user, inputWith([attachment]))).rejects.toMatchObject({
      code: "UPLOAD_NOT_FINALIZED",
    });
  });

  it("keeps existing legacy attachments compatible without requiring a sidecar", async () => {
    await expect(assertFinalizedAttachments(user, inputWith([attachment]), [attachment])).resolves.toBeUndefined();

    expect(storageMocks.requireUploadVerification).not.toHaveBeenCalled();
  });

  it("rejects metadata changes to an existing attachment", async () => {
    const tampered = { ...attachment, sizeBytes: attachment.sizeBytes + 1 };

    await expect(assertFinalizedAttachments(user, inputWith([tampered]), [attachment])).rejects.toMatchObject({
      code: "INVALID_ATTACHMENT",
    });
    expect(storageMocks.requireUploadVerification).not.toHaveBeenCalled();
  });
});
