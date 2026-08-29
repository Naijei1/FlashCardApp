import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  checkPassword,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!checkPassword(password)) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }
  const store = await cookies();
  store.set(SESSION_COOKIE, await signSession(), sessionCookieOptions);
  return NextResponse.json({ ok: true });
}
