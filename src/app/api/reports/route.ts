import { reportFiltersSchema, reportInputSchema } from "@/lib/validation";
import {
  apiResponse,
  assertOwnedAttachments,
  idempotencyKey,
  publicReport,
  reportResponse,
  requestJson,
} from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { getReportRepository } from "@/server/repositories";
import { resolveReportTitle } from "@/lib/report-title";

export async function GET(request: Request): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const url = new URL(request.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const filters = reportFiltersSchema.parse({
      ...raw,
      status: raw.status || "published",
    });
    const page = await getReportRepository().listReports(filters, user);
    return Response.json(
      { ...page, reports: page.reports.map(publicReport) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  });
}

export async function POST(request: Request): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const parsedInput = reportInputSchema.parse(await requestJson(request));
    const input = {
      ...parsedInput,
      title: resolveReportTitle(parsedInput.title, user.displayName),
    };
    assertOwnedAttachments(user, input);
    const report = await getReportRepository().createDraft(
      user,
      input,
      idempotencyKey(request),
    );
    return reportResponse(report, request, 201);
  });
}
