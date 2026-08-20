import { z } from "zod";
import { apiResponse, requestJson } from "@/app/api/_shared";
import { requireCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { toPublicMember } from "@/server/members";
import { getReportRepository } from "@/server/repositories";

const memberIdSchema = z.uuid();
const memberUpdateSchema = z.union([
  z.object({ role: z.enum(["member", "admin"]) }).strict(),
  z.object({ isActive: z.boolean() }).strict(),
]);

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
    const update = memberUpdateSchema.parse(await requestJson(request));
    const repository = getReportRepository();
    let member;
    if ("role" in update) {
      if (memberId === actor.id && update.role === "member") {
        throw new AppError("SELF_DEMOTION_FORBIDDEN", "自分自身をMemberへ変更することはできません", 409);
      }
      member = await repository.setMemberRole(memberId, update.role);
    } else {
      if (memberId === actor.id && !update.isActive) {
        throw new AppError("SELF_DEACTIVATION_FORBIDDEN", "自分自身をInactiveへ変更することはできません", 409);
      }
      const target = await repository.getMember(memberId);
      if (target?.role === "admin" && !update.isActive) {
        throw new AppError("ADMIN_DEACTIVATION_FORBIDDEN", "AdminはInactiveへ変更できません", 409);
      }
      member = target
        ? await repository.setMemberActivity(memberId, update.isActive)
        : null;
    }
    if (!member) throw new AppError("NOT_FOUND", "メンバーが見つかりません", 404);
    return Response.json(toPublicMember(member), {
      headers: { "Cache-Control": "private, no-store" },
    });
  });
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  return apiResponse(async () => {
    const actor = await requireCurrentUser();
    if (actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "メンバーを削除できるのはAdminだけです", 403);
    }

    const memberId = memberIdSchema.parse((await context.params).id);
    if (memberId === actor.id) {
      throw new AppError("SELF_DELETE_FORBIDDEN", "自分自身を削除することはできません", 409);
    }

    const result = await getReportRepository().deleteMember(memberId);
    if (result === "not_found") {
      throw new AppError("NOT_FOUND", "メンバーが見つかりません", 404);
    }
    if (result === "has_reports") {
      throw new AppError(
        "MEMBER_HAS_REPORTS",
        "このメンバーには日報があるため削除できません。過去の記録を保護するため、権限をMemberへ変更してください",
        409,
      );
    }
    return new Response(null, { status: 204 });
  });
}
