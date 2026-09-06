const SENSITIVE_KEY = /(token|secret|password|authorization|cookie|credential|private[_-]?key|api[_-]?key)/i;

export interface AuditActor {
  id: string;
  role?: string | null;
}

export interface AuditEventInput {
  actor: AuditActor;
  action: string;
  targetType: string;
  targetId?: string | null;
  source?: string;
  requestId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[MAX_DEPTH]";
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAuditValue(item, depth + 1));
  if (typeof value === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      sanitized[key] = SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeAuditValue(child, depth + 1);
    }
    return sanitized;
  }
  return String(value);
}

function isLocalDemoMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.DEMO_MODE === "true") return true;
  return !process.env.DEMO_MODE && !process.env.DATABASE_URL;
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  // Unit/API tests use repository doubles and must not import the live DB module.
  // DB access is loaded lazily only for real persistence paths.
  if (process.env.NODE_ENV === "test" || isLocalDemoMode()) return;
  const { getDatabase } = await import("@/server/db/client");
  const sql = getDatabase();
  const before = input.before === undefined ? null : sanitizeAuditValue(input.before);
  const after = input.after === undefined ? null : sanitizeAuditValue(input.after);
  const metadata = sanitizeAuditValue(input.metadata ?? {});
  const beforeJson = before === null ? null : JSON.stringify(before);
  const afterJson = after === null ? null : JSON.stringify(after);
  const metadataJson = JSON.stringify(metadata);

  await sql`insert into audit_events
    (actor_member_id, actor_role, action, target_type, target_id, source, request_id, before_json, after_json, metadata_json)
    values (
      ${input.actor.id}::uuid,
      ${input.actor.role ?? null},
      ${input.action},
      ${input.targetType},
      ${input.targetId ?? null},
      ${input.source ?? "web"},
      ${input.requestId ?? null},
      ${beforeJson}::jsonb,
      ${afterJson}::jsonb,
      ${metadataJson}::jsonb
    )`;
}
