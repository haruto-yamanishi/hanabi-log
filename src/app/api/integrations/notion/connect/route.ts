import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/auth";
import { isDemoMode } from "@/server/env";
import { AppError, errorResponse } from "@/server/errors";
import { createNotionOAuthAuthorizationUrl } from "@/server/integrations/notion-oauth";

export async function GET(): Promise<Response> {
  try {
    if (isDemoMode) {
      throw new AppError(
        "DEMO_MODE",
        "Notion OAuth接続は実運用モードで設定してください",
        409,
      );
    }
    const user = await requireCurrentUser();
    if (user.role !== "admin") {
      throw new AppError(
        "FORBIDDEN",
        "Notion接続を開始できるのはAdminだけです",
        403,
      );
    }
    return NextResponse.redirect(createNotionOAuthAuthorizationUrl(user.id));
  } catch (error) {
    return errorResponse(error);
  }
}
