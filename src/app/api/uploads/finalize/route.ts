import { apiResponse, requestJson } from "@/app/api/_shared";
import { uploadFinalizeSchema } from "@/lib/validation";
import { requireCurrentUser } from "@/server/auth";
import { enforceRateLimit } from "@/server/rate-limit";
import { finalizeStoredUpload } from "@/server/uploads/finalize";

export async function POST(request: Request): Promise<Response> {
  return apiResponse(async () => {
    const user = await requireCurrentUser();
    await enforceRateLimit(request, user.id, "upload");
    const input = uploadFinalizeSchema.parse(await requestJson(request));
    const finalized = await finalizeStoredUpload(user, input);
    return Response.json(finalized, {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
