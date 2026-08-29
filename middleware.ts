import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { SESSION_COOKIE } from "@/lib/constants";

// UX-only redirect layer: every API route and page re-verifies the session
// itself (never trust middleware alone — CVE-2025-29927).
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let authenticated = false;
  if (token && process.env.SESSION_SECRET) {
    try {
      await jwtVerify(token, new TextEncoder().encode(process.env.SESSION_SECRET));
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }

  const { pathname } = request.nextUrl;
  if (pathname === "/login") {
    if (authenticated) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }
  if (!authenticated) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Pages only; API routes return their own 401s. Skip Next internals and PWA assets.
    "/((?!api|_next|favicon.ico|manifest.webmanifest|icon|apple-icon).*)",
  ],
};
