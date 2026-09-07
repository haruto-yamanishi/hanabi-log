import { beforeAll, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/types";

vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({
  env: {
    APP_BASE_URL: undefined,
    SUPABASE_URL: undefined,
    SUPABASE_SECRET_KEY: undefined,
    SUPABASE_STORAGE_BUCKET: "hanabi-log-test",
  },
  isDemoMode: true,
}));

const user: CurrentUser = {
  id: "10000000-0000-4000-8000-000000000001",
  slackUserId: "U_TEST",
  displayName: "Test member",
  role: "member",
  isActive: true,
};

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";

let createSignedUpload: typeof import("@/server/db/storage").createSignedUpload;
let acceptDemoUpload: typeof import("@/server/db/storage").acceptDemoUpload;
let readStoredUpload: typeof import("@/server/db/storage").readStoredUpload;
let requireUploadVerification: typeof import("@/server/db/storage").requireUploadVerification;
let finalizeStoredUpload: typeof import("./finalize").finalizeStoredUpload;

beforeAll(async () => {
  ({
    createSignedUpload,
    acceptDemoUpload,
    readStoredUpload,
    requireUploadVerification,
  } = await import("@/server/db/storage"));
  ({ finalizeStoredUpload } = await import("./finalize"));
});

async function putDemoObject(bytes: Uint8Array, mimeType: "image/png") {
  const signed = await createSignedUpload(
    user,
    { mimeType, sizeBytes: bytes.byteLength },
    "https://hanabi.test",
  );
  await acceptDemoUpload(
    signed.token,
    new Request(signed.signedUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: bytes,
    }),
  );
  return signed.storagePath;
}

describe("upload finalization", () => {
  it("verifies the actual stored bytes and records a reusable verification", async () => {
    const bytes = new Uint8Array(Buffer.from(PNG_1X1, "base64"));
    const storagePath = await putDemoObject(bytes, "image/png");
    const input = {
      storagePath,
      filename: "photo.png",
      mimeType: "image/png" as const,
      sizeBytes: bytes.byteLength,
    };

    await expect(requireUploadVerification(user, input)).rejects.toMatchObject({ code: "UPLOAD_NOT_FINALIZED" });

    const finalized = await finalizeStoredUpload(user, input);
    expect(finalized).toMatchObject({
      storagePath,
      filename: "photo.png",
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
      width: 1,
      height: 1,
    });
    await expect(requireUploadVerification(user, input)).resolves.toBeUndefined();

    await expect(finalizeStoredUpload(user, input)).resolves.toMatchObject({
      storagePath,
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
    });
  });

  it("deletes an invalid orphan object when final validation fails", async () => {
    const bytes = new TextEncoder().encode("not a real png");
    const storagePath = await putDemoObject(bytes, "image/png");

    await expect(finalizeStoredUpload(user, {
      storagePath,
      filename: "fake.png",
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
    })).rejects.toMatchObject({ code: "INVALID_UPLOAD_CONTENT" });

    await expect(readStoredUpload(storagePath)).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });

  it("deletes an object when the filename extension does not match the declared MIME", async () => {
    const bytes = new Uint8Array(Buffer.from(PNG_1X1, "base64"));
    const storagePath = await putDemoObject(bytes, "image/png");

    await expect(finalizeStoredUpload(user, {
      storagePath,
      filename: "photo.jpg",
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
    })).rejects.toMatchObject({ code: "INVALID_UPLOAD_CONTENT" });

    await expect(readStoredUpload(storagePath)).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });

  it("rejects a mismatched declared size and removes the object", async () => {
    const bytes = new Uint8Array(Buffer.from(PNG_1X1, "base64"));
    const storagePath = await putDemoObject(bytes, "image/png");

    await expect(finalizeStoredUpload(user, {
      storagePath,
      filename: "photo.png",
      mimeType: "image/png",
      sizeBytes: bytes.byteLength - 1,
    })).rejects.toMatchObject({ code: "INVALID_UPLOAD_CONTENT" });

    await expect(readStoredUpload(storagePath)).rejects.toMatchObject({ code: "UPLOAD_NOT_FOUND" });
  });

  it("does not allow one member to finalize another member's object path", async () => {
    const bytes = new Uint8Array(Buffer.from(PNG_1X1, "base64"));
    const storagePath = await putDemoObject(bytes, "image/png");
    const another = { ...user, id: "10000000-0000-4000-8000-000000000002" };

    await expect(finalizeStoredUpload(another, {
      storagePath,
      filename: "photo.png",
      mimeType: "image/png",
      sizeBytes: bytes.byteLength,
    })).rejects.toMatchObject({ code: "INVALID_UPLOAD_PATH" });

    await expect(readStoredUpload(storagePath)).resolves.toMatchObject({ mimeType: "image/png" });
  });
});
