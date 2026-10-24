"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { responseError } from "@/lib/response-error";

export default function LearnerAccessButton({
  userId,
  email,
  disabled,
}: {
  userId: string;
  email: string;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const label = email || "this learner";

  async function toggle() {
    const next = !disabled;
    const message = next
      ? `Disable ${label}? Their progress stays, and they cannot sign in until you enable them.`
      : `Enable ${label}? They can sign in again. Their progress is unchanged.`;
    if (!confirm(message)) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/access`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled: next }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) router.refresh();
    else setError(await responseError(res, next ? "Could not disable this learner." : "Could not enable this learner."));
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {disabled && <span className="text-xs font-semibold tracking-wide text-accent uppercase">Disabled</span>}
      <button type="button" onClick={toggle} disabled={busy} className="btn btn-secondary">
        {busy ? "Saving…" : disabled ? "Enable" : "Disable"}
      </button>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
