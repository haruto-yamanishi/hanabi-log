import { z } from "zod";

import type { Report } from "@/lib/types";
import { apiResponse, notFound, reportId, requestJson } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { toIntegrationFailure } from "@/server/integrations/errors";
import { createSlackCommentService } from "@/server/integrations/slack-comments";
import { getReportRepository } from "@/server/repositories";

const commentSchema = z.object({
  body: z.string().trim().min(1, "コメントを入力してください").max(2_000, "コメントは2000文字以内にしてください"),
}).strict();

interface RouteContext {
  params: Promise<{ id: string }>;
}

function slackConfiguration() {
  if (!env.SLACK_BOT_TOKEN) {
    throw new AppError("SLACK_NOT_CONFIGURED", "Slackコメント連携が設定されていません", 503);
  }
  return createSlackCommentService(env.SLACK_BOT_TOKEN);
}

function threadBinding(report: Report) {
  const channel = report?.integration?.slackChannelId;
  const threadTs = report?.integration?.slackMessageTs;
  return channel && threadTs ? { channel, threadTs } : null;
}

function slackFailure(error: unknown): never {
  if (error instanceof AppError) throw error;
  const failure = toIntegrationFailure("slack", error);
  if (failure.statusCode === 429 || failure.code.includes("RATE_LIMIT")) {
    throw new AppError("SLACK_RATE_LIMITED", "Slackとの同期が混み合っています。少し待ってから再度お試しください", 429);
  }
  throw new AppError("SLACK_COMMENT_FAILED", "Slackのコメントを同期できませんでした", 502);
}

function recordCommentContributions(
  reportId: string,
  comments: import("@/lib/types").ReportComment[],
): void {
  const repository = getReportRepository();
  void Promise.resolve(repository.recordContributionEvents(
    comments.flatMap((comment) => comment.author.id ? [{
      memberId: comment.author.id,
      occurredAt: comment.createdAt,
      kind: "comment" as const,
      eventKey: `comment:${reportId}:${comment.source}:${comment.id}`,
      reportId,
    }] : []),
  )).catch((error: unknown) => {
    // A contribution dashboard failure must never hide otherwise readable Slack comments.
    console.error("Could not record comment contribution", { reportId, error });
  });
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    const id = reportId((await context.params).id);
    const repository = getReportRepository();
    const report = await repository.getReadableReport(id, actor);
    if (!report) notFound();
    const binding = threadBinding(report);
    if (!binding) {
      return Response.json(
        { available: false, comments: [] },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

    try {
      const comments = await slackConfiguration().list({
        ...binding,
        members: await repository.listMembers(),
      });
      recordCommentContributions(id, comments);
      return Response.json(
        { available: true, comments },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } catch (error) {
      slackFailure(error);
    }
  });
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    const id = reportId((await context.params).id);
    const repository = getReportRepository();
    const report = await repository.getReadableReport(id, actor);
    if (!report) notFound();
    if (report.status !== "published") {
      throw new AppError("COMMENTS_NOT_AVAILABLE", "公開中の日報にだけコメントできます", 409);
    }
    const binding = threadBinding(report);
    if (!binding) {
      throw new AppError("SLACK_NOT_READY", "Slackへの同期完了後にコメントできます", 409);
    }
    const { body } = commentSchema.parse(await requestJson(request));

    try {
      const comment = await slackConfiguration().post({ ...binding, actor, body });
      recordCommentContributions(id, [comment]);
      return Response.json(comment, {
        status: 201,
        headers: { "Cache-Control": "private, no-store" },
      });
    } catch (error) {
      slackFailure(error);
    }
  });
}
