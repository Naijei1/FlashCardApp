import { NextResponse } from "next/server";
import { authMode } from "@/lib/flags";

export const runtime = "nodejs";

async function handle(method: "GET" | "POST", request: Request) {
  if (authMode() !== "google") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const { handleGoogleAuth } = await import("@/lib/google-auth");
  return handleGoogleAuth(method, request);
}

export function GET(request: Request) {
  return handle("GET", request);
}

export function POST(request: Request) {
  return handle("POST", request);
}
