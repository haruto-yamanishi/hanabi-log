import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export function requestId(): string {
  return `req_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function errorResponse(error: unknown, id = requestId()): Response {
  if (error instanceof ZodError) {
    const fields = Object.fromEntries(
      error.issues.map((issue) => [issue.path.join("."), issue.message]),
    );
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "入力内容を確認してください", fields, requestId: id } },
      { status: 422 },
    );
  }
  if (error instanceof AppError) {
    return Response.json(
      { error: { code: error.code, message: error.message, fields: error.fields, requestId: id } },
      { status: error.status },
    );
  }
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "処理を完了できませんでした", requestId: id } },
    { status: 500 },
  );
}
