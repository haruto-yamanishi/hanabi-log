export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    fields?: Record<string, string>;
    requestId?: string;
  };
}

export class ClientApiError extends Error {
  code?: string;
  fields?: Record<string, string>;
  requestId?: string;

  constructor(payload: ApiErrorPayload, status: number) {
    super(payload.error?.message || `処理を完了できませんでした（${status}）`);
    this.name = "ClientApiError";
    this.code = payload.error?.code;
    this.fields = payload.error?.fields;
    this.requestId = payload.error?.requestId;
  }
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, { ...init, headers });
  const payload = (await response.json().catch(() => ({}))) as T & ApiErrorPayload;
  if (!response.ok) {
    throw new ClientApiError(payload, response.status);
  }
  return unwrapPayload(payload);
}

function unwrapPayload<T>(payload: T): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload;
}

export function makeIdempotencyKey(operation: string): string {
  return `${operation}-${crypto.randomUUID()}`;
}
