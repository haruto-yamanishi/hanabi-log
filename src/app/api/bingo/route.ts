import { apiResponse } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { getBingoEntries } from "@/server/integrations/halloween-bingo";
export async function GET() {
  return apiResponse(async () => {
    await requireCurrentUser();
    return Response.json({ entries:await getBingoEntries() }, {headers:{"Cache-Control":"no-store"}});
  });
}
