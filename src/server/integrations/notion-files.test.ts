import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Attachment } from "@/lib/types";
import { IntegrationError } from "@/server/integrations/errors";
import {
  createNotionFileDependencies,
  PostgresNotionFileUploadState,
  SupabasePrivateAttachmentContent,
} from "@/server/integrations/notion-files";

const attachment: Attachment = {
  id: "attachment-1",
  storagePath: "member/2026-08/robot.png",
  filename: "robot.png",
  mimeType: "image/png",
  sizeBytes: 5,
  sortOrder: 0,
};

function fakeDatabase(responses: unknown[][]) {
  const values: unknown[][] = [];
  const sql = vi.fn(
    async (_strings: TemplateStringsArray, ...parameters: unknown[]) => {
      values.push(parameters);
      return responses.shift() ?? [];
    },
  );
  return { sql, values };
}

describe("SupabasePrivateAttachmentContent", () => {
  it("downloads an object directly from its private storage path", async () => {
    const blob = new Blob(["image"], { type: "image/png" });
    const download = vi.fn(async () => ({ data: blob, error: null }));
    const content = new SupabasePrivateAttachmentContent({ download });

    await expect(content.load(attachment)).resolves.toBe(blob);
    expect(download).toHaveBeenCalledWith(attachment.storagePath);
  });

  it("returns a retryable safe error when private storage fails", async () => {
    const content = new SupabasePrivateAttachmentContent({
      download: vi.fn(async () => ({ data: null, error: new Error("secret") })),
    });

    await expect(content.load(attachment)).rejects.toMatchObject({
      code: "PRIVATE_STORAGE_DOWNLOAD_FAILED",
      retryable: true,
    } satisfies Partial<IntegrationError>);
  });
});

describe("PostgresNotionFileUploadState", () => {
  it("reads and saves a File Upload ID using report and attachment keys", async () => {
    const database = fakeDatabase([
      [{ notion_file_upload_id: "upload-1" }],
      [{ id: "attachment-1" }],
    ]);
    const state = new PostgresNotionFileUploadState(database.sql as never);

    await expect(state.get("report-1", "attachment-1")).resolves.toBe(
      "upload-1",
    );
    await expect(
      state.save("report-1", "attachment-1", "upload-2"),
    ).resolves.toBeUndefined();

    expect(database.values[0]).toContain("report-1");
    expect(database.values[0]).toContain("attachment-1");
    expect(database.values[1]).toContain("upload-2");
  });

  it("fails permanently when the attachment no longer exists", async () => {
    const database = fakeDatabase([[]]);
    const state = new PostgresNotionFileUploadState(database.sql as never);

    await expect(
      state.save("report-1", "missing", "upload-1"),
    ).rejects.toMatchObject({
      code: "ATTACHMENT_STATE_NOT_FOUND",
      retryable: false,
      statusCode: 404,
    } satisfies Partial<IntegrationError>);
  });
});

describe("createNotionFileDependencies", () => {
  it("uses in-memory private bytes and upload state in demo mode", async () => {
    const demoGlobal = globalThis as typeof globalThis & {
      __hanabiDemoObjects?: Map<
        string,
        { bytes: Uint8Array; mimeType: string }
      >;
      __hanabiDemoNotionFileUploads?: Map<string, string>;
    };
    demoGlobal.__hanabiDemoObjects = new Map([
      [
        attachment.storagePath,
        { bytes: Uint8Array.from([1, 2, 3]), mimeType: "image/png" },
      ],
    ]);
    demoGlobal.__hanabiDemoNotionFileUploads = new Map();
    const dependencies = createNotionFileDependencies(true);

    const data = await dependencies.content.load(attachment);
    expect(data.size).toBe(3);
    await dependencies.state.save("report-1", "attachment-1", "upload-1");
    await expect(
      dependencies.state.get("report-1", "attachment-1"),
    ).resolves.toBe("upload-1");
  });
});
