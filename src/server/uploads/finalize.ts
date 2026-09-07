import "server-only";

import { maxBytesForMimeType, type MediaMimeType } from "@/lib/media";
import type { CurrentUser } from "@/lib/types";
import {
  deleteStoredUpload,
  readStoredUpload,
  readUploadVerification,
  writeUploadVerification,
  type UploadVerificationRecord,
} from "@/server/db/storage";
import { AppError } from "@/server/errors";
import { assertMediaNameMatchesMime, validateMediaBytes } from "@/server/uploads/media-validation";

export interface FinalizeUploadInput {
  storagePath: string;
  filename: string;
  mimeType: MediaMimeType;
  sizeBytes: number;
}

export interface FinalizedUpload {
  storagePath: string;
  filename: string;
  mimeType: MediaMimeType;
  sizeBytes: number;
  width?: number;
  height?: number;
}

function invalid(message: string): never {
  throw new AppError("INVALID_UPLOAD_CONTENT", message, 422);
}

function assertGeneratedUploadPath(user: CurrentUser, input: FinalizeUploadInput): void {
  const prefix = `${user.id}/`;
  if (
    !input.storagePath.startsWith(prefix)
    || input.storagePath.includes("..")
    || input.storagePath.includes("\\")
  ) {
    throw new AppError("INVALID_UPLOAD_PATH", "利用できないStorage pathです", 422);
  }

  const relative = input.storagePath.slice(prefix.length);
  const [month, objectName, ...extra] = relative.split("/");
  if (
    extra.length
    || !/^\d{4}-\d{2}$/.test(month ?? "")
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|mp4|webm)$/i.test(objectName ?? "")
  ) {
    throw new AppError("INVALID_UPLOAD_PATH", "Storage pathの形式が不正です", 422);
  }
  assertMediaNameMatchesMime(input.filename, input.storagePath, input.mimeType);
}

function verificationMatches(
  record: UploadVerificationRecord,
  user: CurrentUser,
  input: FinalizeUploadInput,
): boolean {
  return record.ownerId === user.id
    && record.storagePath === input.storagePath
    && record.filename === input.filename
    && record.mimeType === input.mimeType
    && record.sizeBytes === input.sizeBytes;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function cleanupInvalidUpload(storagePath: string): Promise<void> {
  try {
    await deleteStoredUpload(storagePath);
  } catch (error) {
    console.error("Invalid upload cleanup failed", { storagePath, error });
  }
}

export async function finalizeStoredUpload(
  user: CurrentUser,
  input: FinalizeUploadInput,
): Promise<FinalizedUpload> {
  assertGeneratedUploadPath(user, input);

  const existing = await readUploadVerification(input.storagePath);
  if (existing) {
    if (!verificationMatches(existing, user, input)) {
      throw new AppError("INVALID_ATTACHMENT", "既存のアップロード検証情報と一致しません", 422);
    }
    return {
      storagePath: input.storagePath,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    };
  }

  const stored = await readStoredUpload(input.storagePath);
  let shape: ReturnType<typeof validateMediaBytes>;
  try {
    if (
      stored.bytes.byteLength !== input.sizeBytes
      || stored.bytes.byteLength > maxBytesForMimeType(input.mimeType)
    ) {
      invalid("Storage上の実ファイルサイズが申告値と一致しません");
    }
    if (
      stored.mimeType
      && stored.mimeType !== "application/octet-stream"
      && stored.mimeType.split(";", 1)[0] !== input.mimeType
    ) {
      invalid("Storage上のContent-Typeと申告されたMIME typeが一致しません");
    }
    shape = validateMediaBytes(stored.bytes, input.mimeType);
  } catch (error) {
    if (error instanceof AppError && error.code === "INVALID_UPLOAD_CONTENT") {
      await cleanupInvalidUpload(input.storagePath);
    }
    throw error;
  }

  const record: UploadVerificationRecord = {
    version: 1,
    storagePath: input.storagePath,
    ownerId: user.id,
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: stored.bytes.byteLength,
    sha256: await sha256Hex(stored.bytes),
    verifiedAt: new Date().toISOString(),
  };
  await writeUploadVerification(record);

  return {
    storagePath: record.storagePath,
    filename: record.filename,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    width: shape.width,
    height: shape.height,
  };
}
