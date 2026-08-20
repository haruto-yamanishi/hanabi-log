import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function localDemoMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    (process.env.DEMO_MODE === "true" ||
      (!process.env.DEMO_MODE && !process.env.DATABASE_URL))
  );
}

export async function proxy(request: NextRequest) {
  if (localDemoMode()) return NextResponse.next();

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
  });
  if (token) return NextResponse.next();

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "callbackUrl",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/", "/reports/:path*", "/new/:path*", "/archive/:path*", "/me/:path*", "/admin/:path*"],
};
