import { apiResponse, reportId } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { getReportRepository } from "@/server/repositories";

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function setLike(context: RouteContext, liked: boolean): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    const id = reportId((await context.params).id);
    const result = await getReportRepository().setReportLike(id, user, liked);
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}

export async function PUT(_request: Request, context: RouteContext): Promise<Response> {
  return setLike(context, true);
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return setLike(context, false);
}
