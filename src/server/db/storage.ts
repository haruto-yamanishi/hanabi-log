import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  MEDIA_MIME_TYPES,
  STORAGE_BUCKET_MAX_BYTES,
  maxBytesForMimeType,
} from "@/lib/media";
import type { CurrentUser, Report } from "@/lib/types";
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

const globalStorage = globalThis as typeof globalThis & {
  __hanabiSupabase?: SupabaseClient;
  __hanabiDemoUploadGrants?: Map<string, DemoUploadGrant>;
  __hanabiDemoReadGrants?: Map<string, DemoReadGrant>;
  __hanabiDemoObjects?: Map<string, DemoObject>;
  __hanabiStorageBucketReady?: Promise<void>;
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

async function ensureStorageBucketConfiguration(): Promise<void> {
  if (isDemoMode) return;
  globalStorage.__hanabiStorageBucketReady ??= (async () => {
    const { error } = await supabase().storage.updateBucket(
      env.SUPABASE_STORAGE_BUCKET,
      {
        public: false,
        fileSizeLimit: STORAGE_BUCKET_MAX_BYTES,
        allowedMimeTypes: [...MEDIA_MIME_TYPES],
      },
    );
    if (error) {
      throw new AppError(
        "STORAGE_CONFIGURATION_ERROR",
        "添付ストレージを設定できませんでした",
        502,
      );
    }
  })();
  try {
    await globalStorage.__hanabiStorageBucketReady;
  } catch (error) {
    globalStorage.__hanabiStorageBucketReady = undefined;
    throw error;
  }
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
  await ensureStorageBucketConfiguration();
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
    for (const path of paths) demoObjects().delete(path);
    const pathSet = new Set(paths);
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
    .remove(paths);
  if (error) {
    throw new AppError("STORAGE_DELETE_ERROR", "添付ファイルを削除できませんでした", 502);
  }
}
