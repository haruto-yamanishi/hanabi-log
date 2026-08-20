import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import {
  exchangeNotionOAuthCode,
  isValidNotionOAuthState,
} from "@/server/integrations/notion-oauth";

function adminRedirect(request: Request, result: string, reason?: string): Response {
  const url = new URL("/admin", request.url);
  url.searchParams.set("notion", result);
  if (reason) url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const user = await requireCurrentUser();
    if (user.role !== "admin") {
      throw new AppError("FORBIDDEN", "Notion接続はAdminだけが設定できます", 403);
    }
    const params = new URL(request.url).searchParams;
    const oauthError = params.get("error");
    if (oauthError) return adminRedirect(request, "cancelled", oauthError);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state || !isValidNotionOAuthState(state, user.id)) {
      throw new AppError(
        "INVALID_OAUTH_CALLBACK",
        "Notion OAuthの応答を確認できませんでした",
        400,
      );
    }
    await exchangeNotionOAuthCode(code, user.id);
    return adminRedirect(request, "connected");
  } catch (error) {
    const reason = error instanceof AppError ? error.code : "OAUTH_FAILED";
    return adminRedirect(request, "error", reason);
  }
}
