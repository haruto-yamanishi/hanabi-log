import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadFinalizeSchema, uploadRequestSchema } from "@/lib/validation";
import type { CurrentUser } from "@/lib/types";
import type { UploadVerificationRecord } from "./storage";

const storage = vi.hoisted(() => ({
  createClient: vi.fn(),
  updateBucket: vi.fn(),
  from: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: storage.createClient }));
vi.mock("@/server/env", () => ({
  env: {
    SUPABASE_URL: "https://storage.example.test",
    SUPABASE_SECRET_KEY: "test-service-key",
    SUPABASE_STORAGE_BUCKET: "hanabi-log-test",
  },
  isDemoMode: false,
}));

import {
  createSignedUpload,
  readUploadVerification,
  requireUploadVerification,
  writeUploadVerification,
} from "./storage";

const user: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_TEST",
  displayName: "Test member",
  role: "member",
  isActive: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  Reflect.deleteProperty(globalThis, "__hanabiSupabase");
  Reflect.deleteProperty(globalThis, "__hanabiStorageBucketReady");

  let allowedMimeTypes: string[] = [];
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  storage.createClient.mockReturnValue({
    storage: { updateBucket: storage.updateBucket, from: storage.from },
  });
  storage.from.mockReturnValue({
    createSignedUploadUrl: storage.createSignedUploadUrl,
    upload: storage.upload,
    download: storage.download,
  });
  storage.updateBucket.mockImplementation(async (
    _bucket: string,
    options: { allowedMimeTypes: string[] },
  ) => {
    allowedMimeTypes = options.allowedMimeTypes;
    return { error: null };
  });
  storage.createSignedUploadUrl.mockImplementation(async (path: string) => ({
    data: { signedUrl: `https://storage.example.test/upload/${path}`, token: "test-token" },
    error: null,
  }));
  storage.upload.mockImplementation(async (
    path: string,
    body: Uint8Array,
    options: { contentType: string },
  ) => {
    if (!allowedMimeTypes.includes(options.contentType)) {
      return { error: { statusCode: "415", message: "mime type is not supported" } };
    }
    objects.set(path, { body: body.slice(), contentType: options.contentType });
    return { error: null };
  });
  storage.download.mockImplementation(async (path: string) => {
    const object = objects.get(path);
    if (!object) return { data: null, error: { statusCode: "404" } };
    return {
      data: new Blob([new Uint8Array(object.body).buffer], { type: object.contentType }),
      error: null,
    };
  });
});

describe("production upload verification storage", () => {
  it.each(["image/png", "video/mp4"] as const)(
    "persists and reuses a %s verification under the configured bucket MIME policy",
    async (mimeType) => {
      const upload = await createSignedUpload(
        user,
        { mimeType, sizeBytes: 1024 },
        "https://hanabi.test",
      );
      const record: UploadVerificationRecord = {
        version: 1,
        storagePath: upload.storagePath,
        ownerId: user.id,
        filename: mimeType === "image/png" ? "photo.png" : "clip.mp4",
        mimeType,
        sizeBytes: 1024,
        sha256: "a".repeat(64),
        verifiedAt: "2026-09-08T00:00:00.000Z",
      };

      await expect(readUploadVerification(upload.storagePath)).resolves.toBeNull();
      await expect(writeUploadVerification(record)).resolves.toBeUndefined();
      await expect(readUploadVerification(upload.storagePath)).resolves.toEqual(record);
      await expect(requireUploadVerification(user, record)).resolves.toBeUndefined();

      expect(storage.updateBucket).toHaveBeenCalledWith(
        "hanabi-log-test",
        expect.objectContaining({ public: false }),
      );
      expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(
        upload.storagePath,
        { upsert: false },
      );
    },
  );

  it("keeps JSON verification files unavailable as user-uploaded attachments", () => {
    const input = {
      storagePath: `${user.id}/2026-09/test.hanabi-verified.json`,
      filename: "test.hanabi-verified.json",
      mimeType: "application/json",
      sizeBytes: 1024,
    };

    expect(uploadRequestSchema.safeParse(input).success).toBe(false);
    expect(uploadFinalizeSchema.safeParse(input).success).toBe(false);
  });

  it("retries bucket configuration after a temporary failure before issuing an upload URL", async () => {
    storage.updateBucket.mockResolvedValueOnce({ error: { message: "Temporarily unavailable" } });
    const request = { mimeType: "video/mp4", sizeBytes: 1024 };

    await expect(createSignedUpload(user, request, "https://hanabi.test"))
      .rejects.toMatchObject({ code: "STORAGE_CONFIGURATION_ERROR" });
    expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();

    await expect(createSignedUpload(user, request, "https://hanabi.test"))
      .resolves.toMatchObject({ token: "test-token" });
    expect(storage.updateBucket).toHaveBeenCalledTimes(2);
    expect(storage.createSignedUploadUrl).toHaveBeenCalledTimes(1);
  });
});
