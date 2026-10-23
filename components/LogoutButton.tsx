"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { responseError } from "@/lib/response-error";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState<"one" | "all" | null>(null);
  const [error, setError] = useState("");

  async function logout(everywhere: boolean) {
    setBusy(everywhere ? "all" : "one");
    setError("");
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ everywhere }),
    }).catch(() => null);
    setBusy(null);
    if (response?.ok) router.replace("/login");
    else setError(await responseError(response, "Could not log out."));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => void logout(false)}
          disabled={busy !== null}
          className="btn btn-danger min-h-11 px-5"
        >
          {busy === "one" ? "Logging out…" : "Log out"}
        </button>
        <button
          type="button"
          onClick={() => void logout(true)}
          disabled={busy !== null}
          className="btn btn-secondary min-h-11 px-5"
        >
          {busy === "all" ? "Logging out…" : "Log out everywhere"}
        </button>
      </div>
      <p className="max-w-xl text-sm text-muted">
        Log out ends this browser session. Log out everywhere also signs out other browsers
        and the installed home-screen app.
      </p>
      {error && <p role="alert" className="form-error">{error}</p>}
    </div>
  );
}
