"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("Wrong password");
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 pt-safe pb-safe">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <div className="text-center">
          <div className="text-5xl">学</div>
          <h1 className="mt-3 text-xl font-semibold">Chinese Flashcards</h1>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-lg outline-none focus:border-accent"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded-xl bg-accent px-4 py-3 text-lg font-medium text-accent-foreground disabled:opacity-50"
        >
          {busy ? "…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
