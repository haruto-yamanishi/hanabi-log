import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";

export async function GET(): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    return Response.json(user, { headers: { "Cache-Control": "private, no-store" } });
  });
}
