import { z } from "zod";
import { apiResponse, requestJson } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { toPublicMember } from "@/server/members";
import { getReportRepository } from "@/server/repositories";

const memberIdSchema = z.uuid();
const memberRoleSchema = z.object({ role: z.enum(["member", "admin"]) }).strict();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    if (actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "メンバーの権限を変更できるのはAdminだけです", 403);
    }

    const memberId = memberIdSchema.parse((await context.params).id);
    const { role } = memberRoleSchema.parse(await requestJson(request));
    if (memberId === actor.id && role === "member") {
      throw new AppError("SELF_DEMOTION_FORBIDDEN", "自分自身をMemberへ変更することはできません", 409);
    }

    const member = await getReportRepository().setMemberRole(memberId, role);
    if (!member) throw new AppError("NOT_FOUND", "メンバーが見つかりません", 404);
    return Response.json(toPublicMember(member), {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}
