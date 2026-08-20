import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { isDemoMode } from "@/server/env";
import { AppError } from "@/server/errors";
import { revokeNotionOAuthConnection } from "@/server/integrations/notion-oauth";
import { getNotionOAuthConnectionSummary } from "@/server/integrations/notion-oauth-store";

async function requireAdmin(): Promise<void> {
  const user = await requireCurrentUser();
  if (user.role !== "admin") {
    throw new AppError(
      "FORBIDDEN",
      "Notion接続を管理できるのはAdminだけです",
      403,
    );
  }
}

export async function GET(): Promise<Response> {
  return apiResponse(async () => {
    await requireAdmin();
    if (isDemoMode) {
      return Response.json(
        { connected: false, available: false },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return Response.json(await getNotionOAuthConnectionSummary(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}

export async function DELETE(): Promise<Response> {
  return apiResponse(async () => {
    await requireAdmin();
    await revokeNotionOAuthConnection();
    return new Response(null, { status: 204 });
  });
}
