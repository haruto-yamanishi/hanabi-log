export type IntegrationTarget = "slack" | "notion";

export interface IntegrationFailure {
  code: string;
  retryable: boolean;
  statusCode?: number;
  retryAfterMs?: number;
}

interface IntegrationErrorOptions {
  retryable: boolean;
  statusCode?: number;
  retryAfterMs?: number;
  cause?: unknown;
}

/**
 * An error safe to persist. `code` must describe the class of failure and must
 * never contain user content, credentials, URLs, or an upstream response body.
 */
export class IntegrationError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;

  constructor(code: string, options: IntegrationErrorOptions) {
    super(code, { cause: options.cause });
    this.name = "IntegrationError";
    this.code = sanitizeCode(code);
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
    this.retryAfterMs = options.retryAfterMs;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function numericValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function sanitizeCode(value: unknown): string {
  if (typeof value !== "string") return "UNKNOWN";
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80);
  return normalized || "UNKNOWN";
}

function upstreamCode(error: Record<string, unknown>): string {
  const data = asRecord(error.data);
  return sanitizeCode(
    data?.error ?? data?.code ?? error.code ?? error.name ?? "UNKNOWN",
  );
}

function upstreamStatus(error: Record<string, unknown>): number | undefined {
  const data = asRecord(error.data);
  return numericValue(
    error.statusCode ?? error.status ?? data?.statusCode ?? data?.status,
  );
}

function retryAfterMs(error: Record<string, unknown>): number | undefined {
  const data = asRecord(error.data);
  const explicitMs = numericValue(error.retryAfterMs ?? data?.retryAfterMs);
  if (explicitMs !== undefined) return Math.max(0, explicitMs);

  // Slack's SDK exposes retryAfter in seconds.
  const seconds = numericValue(error.retryAfter ?? data?.retryAfter);
  return seconds === undefined ? undefined : Math.max(0, seconds * 1_000);
}

export function toIntegrationFailure(
  target: IntegrationTarget,
  error: unknown,
): IntegrationFailure {
  if (error instanceof IntegrationError) {
    return {
      code: `${target.toUpperCase()}_${error.code}`,
      retryable: error.retryable,
      statusCode: error.statusCode,
      retryAfterMs: error.retryAfterMs,
    };
  }

  const record = asRecord(error) ?? {};
  const code = upstreamCode(record);
  const statusCode = upstreamStatus(record);
  const retryDelay = retryAfterMs(record);
  const isRateLimit = statusCode === 429 || code.includes("RATE_LIMIT");
  const retryableStatus =
    statusCode === undefined || statusCode >= 500 || statusCode === 408;
  const permanentStatus =
    statusCode !== undefined && [400, 401, 403, 404, 409, 422].includes(statusCode);

  return {
    code: `${target.toUpperCase()}_${code}`,
    retryable: isRateLimit || (!permanentStatus && retryableStatus),
    statusCode,
    retryAfterMs: retryDelay,
  };
}

export function formatPersistedFailure(failure: IntegrationFailure): string {
  return failure.statusCode
    ? `${sanitizeCode(failure.code)}:${failure.statusCode}`
    : sanitizeCode(failure.code);
}
