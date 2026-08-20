import { z } from "zod";
import type {
  CurrentUser,
  IntegrationBinding,
  Report,
  ReportListItem,
  ReportInput,
} from "@/lib/types";
import { errorResponse, AppError } from "@/server/errors";
import { signReportAttachments } from "@/server/db/storage";

const reportIdSchema = z.uuid();

export async function apiResponse(operation: () => Promise<Response>): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    return errorResponse(error);
  }
}

export async function requestJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("INVALID_JSON", "JSONリクエストを確認してください", 400);
  }
}

export function reportId(value: string): string {
  return reportIdSchema.parse(value);
}

export function idempotencyKey(request: Request): string | undefined {
  const value = request.headers.get("idempotency-key")?.trim();
  if (!value) return undefined;
  if (value.length > 200) {
    throw new AppError("INVALID_IDEMPOTENCY_KEY", "Idempotency-Keyが長すぎます", 422);
  }
  return value;
}

export function assertOwnedAttachments(
  user: CurrentUser,
  input: ReportInput,
  ownerIds: readonly string[] = [user.id],
): void {
  const allowedPrefixes = new Set([...ownerIds, user.id].map((id) => `${id}/`));
  if (
    input.attachments?.some(
      (attachment) =>
        ![...allowedPrefixes].some((prefix) => attachment.storagePath.startsWith(prefix)) ||
        attachment.storagePath.includes("..") ||
        attachment.storagePath.includes("\\"),
    )
  ) {
    throw new AppError("INVALID_ATTACHMENT", "利用できない画像が含まれています", 422);
  }
}

export async function reportResponse(
  report: Report,
  request: Request,
  status = 200,
): Promise<Response> {
  const origin = new URL(request.url).origin;
  const signed = await signReportAttachments(report, origin);
  return Response.json(publicReport(signed), {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** Removes authentication and provider identifiers from browser-facing DTOs. */
export function publicReport(report: Report): Report {
  const author = {
    id: report.author.id,
    displayName: report.author.displayName,
    avatarUrl: report.author.avatarUrl ?? null,
  };
  const integration = report.integration
    ? ({
        reportId: report.integration.reportId,
        notionPageUrl: report.integration.notionPageUrl ?? null,
        notionStatus: report.integration.notionStatus,
        notionLastError: report.integration.notionLastError ?? null,
        slackPermalink: report.integration.slackPermalink ?? null,
        slackStatus: report.integration.slackStatus,
        slackLastError: report.integration.slackLastError ?? null,
        updatedAt: report.integration.updatedAt,
      } satisfies IntegrationBinding)
    : report.integration;
  return { ...report, author, integration };
}

/** List endpoints intentionally omit body/attachment data and provider identifiers. */
export function publicReportListItem(report: ReportListItem): ReportListItem {
  return {
    ...report,
    author: {
      id: report.author.id,
      displayName: report.author.displayName,
      avatarUrl: report.author.avatarUrl ?? null,
    },
    integration: report.integration
      ? {
          reportId: report.integration.reportId,
          notionPageUrl: report.integration.notionPageUrl ?? null,
          notionStatus: report.integration.notionStatus,
          notionLastError: report.integration.notionLastError ?? null,
          slackPermalink: report.integration.slackPermalink ?? null,
          slackStatus: report.integration.slackStatus,
          slackLastError: report.integration.slackLastError ?? null,
          updatedAt: report.integration.updatedAt,
        }
      : report.integration,
  };
}

export function notFound(): never {
  throw new AppError("NOT_FOUND", "日報が見つかりません", 404);
}
