import { canDeleteReport } from "@/lib/authorization";
import { deleteReportAttachments } from "@/server/db/storage";
import { reportPatchSchema } from "@/lib/validation";
import {
  apiResponse,
  assertOwnedAttachments,
  notFound,
  reportId,
  reportResponse,
  requestJson,
} from "@/app/api/_shared";
import { recordAuditEvent } from "@/server/audit";
import { requireCurrentUser } from "@/server/auth";
import { scheduleReportJobs } from "@/server/integrations/schedule";
import { getReportRepository } from "@/server/repositories";
import { resolveReportTitle } from "@/lib/report-title";
import { AppError } from "@/server/errors";
import { deleteReportResources } from "@/server/reports/delete-report-resources";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const id = reportId((await context.params).id);
    const report = await getReportRepository().getReadableReport(id, user);
    if (!report) notFound();
    return reportResponse(report, request);
  });
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const id = reportId((await context.params).id);
    const parsedInput = reportPatchSchema.parse(await requestJson(request));
    const existing = await getReportRepository().getReadableReport(id, user);
    if (!existing) notFound();
    const input = {
      ...parsedInput,
      report: {
        ...parsedInput.report,
        title: resolveReportTitle(parsedInput.report.title, existing.author.displayName),
      },
    };
    assertOwnedAttachments(user, input.report, [existing.authorId]);
    const report = await getReportRepository().patchReport(
      id,
      user,
      input.version,
      input.report,
    );
    await recordAuditEvent({
      actor: user,
      action: "report.edited",
      targetType: "report",
      targetId: id,
      before: { status: existing.status, version: existing.version },
      after: { status: report.status, version: report.version },
    });
    if (report.status === "published") scheduleReportJobs(id);
    return reportResponse(report, request);
  });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const id = reportId((await context.params).id);
    const repository = getReportRepository();
    const report = await repository.getReadableReport(id, user);
    if (!report) notFound();

    if (!canDeleteReport(user, report)) {
      throw new AppError("FORBIDDEN", "この日報は削除できません", 403);
    }
    if (report.status === "draft") {
      // Delete conditionally before removing files: a concurrent publish/edit must win safely.
      await repository.deleteReport(id, user, report.version);
      try {
        await deleteReportAttachments(report);
      } catch (error) {
        console.error("Deleted draft attachment cleanup failed", { reportId: id, error });
      }
    } else {
      await deleteReportResources(report);
      await repository.deleteReport(id, user);
    }
    await recordAuditEvent({
      actor: user,
      action: "report.deleted",
      targetType: "report",
      targetId: id,
      before: { status: report.status, version: report.version },
    });
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
