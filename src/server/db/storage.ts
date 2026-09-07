import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { maxBytesForMimeType } from "@/lib/media";
import type { Attachment, CurrentUser, Report } from "@/lib/types";
import { env, isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";

interface DemoUploadGrant {
  storagePath: string;
  mimeType: string;
  maxSize: number;
  expiresAt: number;
}

interface DemoReadGrant {
  storagePath: string;
  expiresAt: number;
}

interface DemoObject {
  bytes: Uint8Array;
  mimeType: string;
}

export interface UploadVerificationRecord {
  version: 1;
  storagePath: string;
  ownerId: string;
  filename: string;
  mimeType: Attachment["mimeType"];
  sizeBytes: number;
  sha256: string;
  verifiedAt: string;
}

const globalStorage = globalThis as typeof globalThis & {
  __hanabiSupabase?: SupabaseClient;
  __hanabiDemoUploadGrants?: Map<string, DemoUploadGrant>;
  __hanabiDemoReadGrants?: Map<string, DemoReadGrant>;
  __hanabiDemoObjects?: Map<string, DemoObject>;
  __hanabiDemoUploadVerifications?: Map<string, UploadVerificationRecord>;
};

function supabase(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required outside demo mode");
  }
  globalStorage.__hanabiSupabase ??= createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return globalStorage.__hanabiSupabase;
}

function uploadGrants(): Map<string, DemoUploadGrant> {
  globalStorage.__hanabiDemoUploadGrants ??= new Map();
  return globalStorage.__hanabiDemoUploadGrants;
}

function readGrants(): Map<string, DemoReadGrant> {
  globalStorage.__hanabiDemoReadGrants ??= new Map();
  return globalStorage.__hanabiDemoReadGrants;
}

function demoObjects(): Map<string, DemoObject> {
  globalStorage.__hanabiDemoObjects ??= new Map();
  return globalStorage.__hanabiDemoObjects;
}

function demoVerifications(): Map<string, UploadVerificationRecord> {
  globalStorage.__hanabiDemoUploadVerifications ??= new Map();
  return globalStorage.__hanabiDemoUploadVerifications;
}

function extension(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "video/mp4") return "mp4";
  return "webm";
}

function absoluteApiUrl(origin: string, parameters: URLSearchParams): string {
  const base = env.APP_BASE_URL || origin;
  return `${base.replace(/\/$/, "")}/api/uploads?${parameters.toString()}`;
}

function verificationStoragePath(storagePath: string): string {
  return `${storagePath}.hanabi-verified.json`;
}

function storageStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null;
  const value = (error as { statusCode?: unknown }).statusCode;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function parseVerificationRecord(value: unknown): UploadVerificationRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<UploadVerificationRecord>;
  if (
    record.version !== 1
    || typeof record.storagePath !== "string"
    || typeof record.ownerId !== "string"
    || typeof record.filename !== "string"
    || typeof record.mimeType !== "string"
    || typeof record.sizeBytes !== "number"
    || !Number.isInteger(record.sizeBytes)
    || record.sizeBytes <= 0
    || typeof record.sha256 !== "string"
    || !/^[0-9a-f]{64}$/.test(record.sha256)
    || typeof record.verifiedAt !== "string"
  ) {
    return null;
  }
  return record as UploadVerificationRecord;
}

export async function createSignedUpload(
  user: CurrentUser,
  request: { mimeType: string; sizeBytes: number },
  origin: string,
): Promise<{ storagePath: string; signedUrl: string; token: string }> {
  const month = new Date().toISOString().slice(0, 7);
  const storagePath = `${user.id}/${month}/${crypto.randomUUID()}.${extension(request.mimeType)}`;
  if (isDemoMode) {
    const token = crypto.randomUUID();
    uploadGrants().set(token, {
      storagePath,
      mimeType: request.mimeType,
      maxSize: request.sizeBytes,
      expiresAt: Date.now() + 5 * 60_000,
    });
    return {
      storagePath,
      token,
      signedUrl: absoluteApiUrl(origin, new URLSearchParams({ mode: "upload", token })),
    };
  }
  const { data, error } = await supabase()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath, { upsert: false });
  if (error || !data) {
    throw new AppError("STORAGE_ERROR", "アップロードURLを発行できませんでした", 502);
  }
  return { storagePath, signedUrl: data.signedUrl, token: data.token };
}

export async function acceptDemoUpload(token: string, request: Request): Promise<void> {
  if (!isDemoMode) throw new AppError("NOT_FOUND", "アップロード先が見つかりません", 404);
  const grant = uploadGrants().get(token);
  if (!grant || grant.expiresAt < Date.now()) {
    uploadGrants().delete(token);
    throw new AppError("UPLOAD_URL_EXPIRED", "アップロードURLの有効期限が切れています", 410);
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType !== grant.mimeType) {
    throw new AppError("INVALID_CONTENT_TYPE", "ファイル形式が発行時と一致しません", 415);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (
    !bytes.length
    || bytes.byteLength > grant.maxSize
    || bytes.byteLength > maxBytesForMimeType(grant.mimeType)
  ) {
    throw new AppError("INVALID_FILE_SIZE", "ファイルサイズが発行時と一致しません", 422);
  }
  demoObjects().set(grant.storagePath, { bytes, mimeType: grant.mimeType });
  uploadGrants().delete(token);
}

export async function readStoredUpload(
  storagePath: string,
): Promise<{ bytes: Uint8Array; mimeType: string | null }> {
  if (isDemoMode) {
    const object = demoObjects().get(storagePath);
    if (!object) throw new AppError("UPLOAD_NOT_FOUND", "アップロード済みファイルが見つかりません", 404);
    return { bytes: object.bytes.slice(), mimeType: object.mimeType };
  }

  const { data, error } = await supabase()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .download(storagePath);
  if (error || !data) {
    if (storageStatusCode(error) === 404) {
      throw new AppError("UPLOAD_NOT_FOUND", "アップロード済みファイルが見つかりません", 404);
    }
    throw new AppError("STORAGE_ERROR", "アップロード済みファイルを確認できませんでした", 502);
  }
  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    mimeType: data.type || null,
  };
}

export async function writeUploadVerification(record: UploadVerificationRecord): Promise<void> {
  if (isDemoMode) {
    demoVerifications().set(record.storagePath, structuredClone(record));
    return;
  }

  const body = new TextEncoder().encode(JSON.stringify(record));
  const { error } = await supabase()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .upload(verificationStoragePath(record.storagePath), body, {
      contentType: "application/json",
      cacheControl: "0",
      upsert: true,
    });
  if (error) throw new AppError("STORAGE_ERROR", "アップロード検証結果を保存できませんでした", 502);
}

export async function readUploadVerification(storagePath: string): Promise<UploadVerificationRecord | null> {
  if (isDemoMode) {
    const record = demoVerifications().get(storagePath);
    return record ? structuredClone(record) : null;
  }

  const { data, error } = await supabase()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .download(verificationStoragePath(storagePath));
  if (error || !data) {
    if (storageStatusCode(error) === 404) return null;
    throw new AppError("STORAGE_ERROR", "アップロード検証結果を確認できませんでした", 502);
  }
  try {
    return parseVerificationRecord(JSON.parse(await data.text()));
  } catch {
    return null;
  }
}

export async function requireUploadVerification(
  user: CurrentUser,
  attachment: Pick<Attachment, "storagePath" | "filename" | "mimeType" | "sizeBytes">,
): Promise<void> {
  const record = await readUploadVerification(attachment.storagePath);
  if (!record) {
    throw new AppError(
      "UPLOAD_NOT_FINALIZED",
      "添付ファイルの安全確認が完了していません。もう一度アップロードしてください",
      422,
    );
  }
  if (
    record.ownerId !== user.id
    || record.storagePath !== attachment.storagePath
    || record.filename !== attachment.filename
    || record.mimeType !== attachment.mimeType
    || record.sizeBytes !== attachment.sizeBytes
  ) {
    throw new AppError("INVALID_ATTACHMENT", "添付ファイルの検証情報が一致しません", 422);
  }
}

export async function deleteStoredUpload(storagePath: string): Promise<void> {
  if (isDemoMode) {
    demoObjects().delete(storagePath);
    demoVerifications().delete(storagePath);
    const pathSet = new Set([storagePath]);
    for (const [token, grant] of uploadGrants()) {
      if (pathSet.has(grant.storagePath)) uploadGrants().delete(token);
    }
    for (const [token, grant] of readGrants()) {
      if (pathSet.has(grant.storagePath)) readGrants().delete(token);
    }
    return;
  }

  const { error } = await supabase()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .remove([storagePath, verificationStoragePath(storagePath)]);
  if (error) throw new AppError("STORAGE_DELETE_ERROR", "添付ファイルを削除できませんでした", 502);
}

async function createSignedReadUrl(storagePath: string, origin: string): Promise<string> {
  if (isDemoMode) {
    const token = crypto.randomUUID();
    readGrants().set(token, { storagePath, expiresAt: Date.now() + 5 * 60_000 });
    return absoluteApiUrl(origin, new URLSearchParams({ mode: "read", token }));
  }
  const { data, error } = await supabase()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .createSignedUrl(storagePath, 300);
  if (error || !data) {
    throw new AppError("STORAGE_ERROR", "添付ファイルURLを発行できませんでした", 502);
  }
  return data.signedUrl;
}

export function readDemoObject(token: string): { bytes: Uint8Array; mimeType: string } | null {
  if (!isDemoMode) return null;
  const grant = readGrants().get(token);
  if (!grant || grant.expiresAt < Date.now()) {
    readGrants().delete(token);
    return null;
  }
  return demoObjects().get(grant.storagePath) ?? null;
}

export async function signReportAttachments(report: Report, origin: string): Promise<Report> {
  if (!report.attachments.length) return report;
  return {
    ...report,
    attachments: await Promise.all(
      report.attachments.map(async (attachment) => ({
        ...attachment,
        signedUrl: await createSignedReadUrl(attachment.storagePath, origin),
      })),
    ),
  };
}

export async function deleteReportAttachments(report: Report): Promise<void> {
  const paths = [...new Set(report.attachments.map((attachment) => attachment.storagePath))];
  if (paths.length === 0) return;

  if (isDemoMode) {
    for (const path of paths) {
      demoObjects().delete(path);
      demoVerifications().delete(path);
    }
    const pathSet = new Set(paths);
    for (const [token, grant] of uploadGrants()) {
      if (pathSet.has(grant.storagePath)) uploadGrants().delete(token);
    }
    for (const [token, grant] of readGrants()) {
      if (pathSet.has(grant.storagePath)) readGrants().delete(token);
    }
    return;
  }

  const objectPaths = paths.flatMap((path) => [path, verificationStoragePath(path)]);
  const { error } = await supabase()
    .storage.from(env.SUPABASE_STORAGE_BUCKET)
    .remove(objectPaths);
  if (error) {
    throw new AppError("STORAGE_DELETE_ERROR", "添付ファイルを削除できませんでした", 502);
  }
}
