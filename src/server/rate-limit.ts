import { createHmac } from "node:crypto";
import { AppError } from "@/server/errors";

export type RateLimitBucket =
  | "read"
  | "write"
  | "upload"
  | "reaction"
  | "admin"
  | "integration";

export type RateLimitMode = "off" | "enforce";

const WINDOW_MS = 60_000;

const DEFAULT_LIMITS: Record<RateLimitBucket, number> = {
  read: 120,
  write: 30,
  upload: 12,
  reaction: 60,
  admin: 20,
  integration: 10,
};

const ENV_KEYS: Record<RateLimitBucket, string> = {
  read: "RATE_LIMIT_READ_PER_MINUTE",
  write: "RATE_LIMIT_WRITE_PER_MINUTE",
  upload: "RATE_LIMIT_UPLOAD_PER_MINUTE",
  reaction: "RATE_LIMIT_REACTION_PER_MINUTE",
  admin: "RATE_LIMIT_ADMIN_PER_MINUTE",
  integration: "RATE_LIMIT_INTEGRATION_PER_MINUTE",
};

interface RateLimitCounterRow {
  request_count: number;
}

type RateLimitEnvironment = Record<string, string | undefined>;

export interface RateLimitDecision {
  bucket: RateLimitBucket;
  limit: number;
  count: number;
  retryAfterSeconds: number;
}

export function configuredRateLimitMode(
  environment: RateLimitEnvironment = process.env,
): RateLimitMode {
  const raw = environment.RATE_LIMIT_MODE?.trim().toLowerCase();
  if (!raw || raw === "off") return "off";
  if (raw === "enforce") return "enforce";
  throw new Error("RATE_LIMIT_MODE must be either 'off' or 'enforce'");
}

export function configuredRateLimit(
  bucket: RateLimitBucket,
  environment: RateLimitEnvironment = process.env,
): number {
  const raw = environment[ENV_KEYS[bucket]]?.trim();
  if (!raw) return DEFAULT_LIMITS[bucket];
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100_000) {
    return DEFAULT_LIMITS[bucket];
  }
  return parsed;
}

function boundedProxyValue(value: string | null): string | null {
  const candidate = value?.split(",", 1)[0]?.trim();
  return candidate ? candidate.slice(0, 128) : null;
}

export function extractClientIp(
  headers: Headers,
  environment: RateLimitEnvironment = process.env,
): string {
  // On Vercel, prefer the platform-owned header. In production we do not
  // fall back to client-spoofable forwarded headers if that trusted signal is
  // missing; all such requests intentionally share the "unknown" network key.
  const vercelForwarded = boundedProxyValue(headers.get("x-vercel-forwarded-for"));
  if (vercelForwarded) return vercelForwarded;
  if (environment.NODE_ENV === "production") return "unknown";

  const forwarded = boundedProxyValue(headers.get("x-forwarded-for"));
  if (forwarded) return forwarded;
  return boundedProxyValue(headers.get("x-real-ip")) ?? "unknown";
}

function localDemoMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (
    process.env.DEMO_MODE === "true" ||
    (!process.env.DEMO_MODE && !process.env.DATABASE_URL)
  );
}

function identityHash(kind: "member" | "network", value: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET is required for API rate-limit identity hashing");
  }
  return createHmac("sha256", secret || "hanabi-rate-limit-development")
    .update(`${kind}:${value}`)
    .digest("hex");
}

function windowStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
}

export function retryAfterSeconds(now: Date): number {
  const start = windowStart(now).getTime();
  return Math.max(1, Math.ceil((start + WINDOW_MS - now.getTime()) / 1_000));
}

async function incrementCounter(
  bucket: RateLimitBucket,
  keyHash: string,
  start: Date,
): Promise<number> {
  const { getDatabase } = await import("@/server/db/client");
  const sql = getDatabase();
  const rows = await sql<RateLimitCounterRow[]>`
    insert into api_rate_limit_windows (
      bucket, key_hash, window_start, request_count, created_at, updated_at
    ) values (
      ${bucket}, ${keyHash}, ${start}, 1, now(), now()
    )
    on conflict (bucket, key_hash, window_start) do update set
      request_count = api_rate_limit_windows.request_count + 1,
      updated_at = now()
    returning request_count
  `;
  return Number(rows[0]?.request_count ?? 1);
}

export async function enforceRateLimit(
  request: Request,
  memberId: string,
  bucket: RateLimitBucket,
  now = new Date(),
): Promise<RateLimitDecision | null> {
  // Route unit tests and local demo mode use repository doubles and should not need a live DB.
  if (process.env.NODE_ENV === "test" || localDemoMode()) return null;

  // Safe staged rollout: code may be deployed before the migration, but
  // production enforcement is activated only after the table exists.
  if (configuredRateLimitMode() === "off") return null;

  const limit = configuredRateLimit(bucket);
  const networkLimit = limit * 4;
  const start = windowStart(now);
  const memberKey = identityHash("member", memberId);
  const networkKey = identityHash("network", extractClientIp(request.headers));

  const memberCount = await incrementCounter(bucket, memberKey, start);
  const networkCount = await incrementCounter(bucket, networkKey, start);
  const retryAfter = retryAfterSeconds(now);

  if (memberCount > limit || networkCount > networkLimit) {
    throw new AppError(
      "RATE_LIMITED",
      "短時間にリクエストが集中しています。少し待ってから再試行してください",
      429,
      undefined,
      { "Retry-After": String(retryAfter) },
    );
  }

  return {
    bucket,
    limit,
    count: memberCount,
    retryAfterSeconds: retryAfter,
  };
}
