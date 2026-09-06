import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createCspHeader, cspHeaderName } from "@/lib/security/csp";

const PROTECTED_PATHS = ["/reports", "/new", "/archive", "/me", "/admin"];

function localDemoMode(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (
    process.env.DEMO_MODE === "true" ||
    (!process.env.DEMO_MODE && !process.env.DATABASE_URL)
  );
}

function requiresAuthentication(pathname: string): boolean {
  return (
    pathname === "/" ||
    PROTECTED_PATHS.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}

function cspContext(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const value = createCspHeader(nonce, process.env.NODE_ENV === "development");
  const reportOnly = process.env.CSP_REPORT_ONLY === "true";
  const name = cspHeaderName(reportOnly);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set(name, value);
  return { name, value, headers };
}

function nextWithCsp(request: NextRequest): NextResponse {
  const csp = cspContext(request);
  const response = NextResponse.next({ request: { headers: csp.headers } });
  response.headers.set(csp.name, csp.value);
  return response;
}

export async function proxy(request: NextRequest) {
  if (!requiresAuthentication(request.nextUrl.pathname) || localDemoMode()) {
    return nextWithCsp(request);
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
  });
  if (token) return nextWithCsp(request);

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  const csp = cspContext(request);
  const response = NextResponse.redirect(loginUrl);
  response.headers.set(csp.name, csp.value);
  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sw.js|offline.html).*)",
  ],
};
