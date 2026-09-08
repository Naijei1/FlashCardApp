"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { responseError } from "@/lib/response-error";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    const response = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    setBusy(false);
    if (response?.ok) router.replace("/login");
    else setError(await responseError(response, "Could not log out."));
  }
  return (
    <div className="space-y-2">
      <button
        onClick={logout}
        disabled={busy}
        className="rounded-xl border border-red-500/40 px-5 py-3 font-medium text-red-500 disabled:opacity-50"
      >
        {busy ? "Logging out…" : "Log out"}
      </button>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
