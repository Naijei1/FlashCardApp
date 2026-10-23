import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth";
import { authMode } from "@/lib/flags";

export async function POST() {
  if (authMode() === "google") {
    const { signOutGoogle } = await import("@/lib/google-auth");
    await signOutGoogle();
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
