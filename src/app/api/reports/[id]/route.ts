import { reportPatchSchema } from "@/lib/validation";
import {
  apiResponse,
  assertOwnedAttachments,
  notFound,
  reportId,
  reportResponse,
  requestJson,
} from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { processReportJobs } from "@/server/integrations/outbox";
import { getReportRepository } from "@/server/repositories";
import { resolveReportTitle } from "@/lib/report-title";

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
    let report = await getReportRepository().patchReport(
      id,
      user,
      input.version,
      input.report,
    );
    if (report.status === "published") {
      await processReportJobs(id);
      report = (await getReportRepository().getReadableReport(id, user)) ?? report;
    }
    return reportResponse(report, request);
  });
}
