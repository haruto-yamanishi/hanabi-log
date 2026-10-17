import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { listSystemDmHistory } from "@/server/integrations/system-dm-history";

export async function GET(): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    if (user.role !== "admin") throw new AppError("FORBIDDEN", "通知履歴は管理者だけが閲覧できます", 403);
    return Response.json(await listSystemDmHistory(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
