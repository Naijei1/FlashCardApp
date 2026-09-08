import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose/jwt/verify";
import { SESSION_COOKIE } from "@/lib/constants";

// UX-only redirect for authenticated visitors who open the login page. The
// protected layout and every API route enforce auth themselves, avoiding a
// duplicate middleware invocation/JWT verification on every app navigation.
export async function middleware(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let authenticated = false;
  if (token && (process.env.SESSION_SECRET_HEX || process.env.SESSION_SECRET)) {
    try {
      const encoded = process.env.SESSION_SECRET_HEX;
      if (encoded && (encoded.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(encoded))) {
        throw new Error("SESSION_SECRET_HEX is invalid");
      }
      // Middleware runs at the edge, where Node's Buffer is unavailable.
      const key = encoded
        ? Uint8Array.from(encoded.match(/.{2}/g)!, (byte) => Number.parseInt(byte, 16))
        : new TextEncoder().encode(process.env.SESSION_SECRET);
      await jwtVerify(token, key);
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
  matcher: ["/login"],
};
