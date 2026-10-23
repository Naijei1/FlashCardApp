"use server";

import { authMode } from "@/lib/flags";

export async function signInWithGoogle() {
  if (authMode() !== "google") throw new Error("Google sign-in is disabled");
  const { signInWithGoogleProvider } = await import("@/lib/google-auth");
  await signInWithGoogleProvider();
}
