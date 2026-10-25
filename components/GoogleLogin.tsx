"use client";

import { useSyncExternalStore, useEffect, useState } from "react";
import { signInWithGoogle } from "@/app/login/actions";
import { googleSignInError } from "@/lib/google-sign-in-error";
import { isIosHomeScreenApp } from "@/lib/ios-standalone";

function subscribe() {
  return () => {};
}

function standaloneSnapshot() {
  return isIosHomeScreenApp(window.navigator);
}

function standaloneServerSnapshot() {
  return false;
}

export default function GoogleLogin({ error }: { error?: string }) {
  const standalone = useSyncExternalStore(subscribe, standaloneSnapshot, standaloneServerSnapshot);
  const message = googleSignInError(error);
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 pt-safe pb-safe">
      <div className="w-full max-w-xs space-y-4 text-center">
        <div className="hanzi-text text-5xl leading-tight">学</div>
        <h1 className="text-xl font-semibold">Chinese Flashcards</h1>
        <p className="text-sm text-muted">
          {standalone
            ? "Google opens in Safari. Come back to this app after the codes match."
            : "Sign in with Google. New accounts can study right away."}
        </p>
        {message && (
          <p role="alert" className="text-sm text-red-500">
            {message}
          </p>
        )}
        {standalone ? <HomeScreenGoogleSignIn /> : <BrowserGoogleSignIn />}
      </div>
    </main>
  );
}

function BrowserGoogleSignIn() {
  return (
    <form action={signInWithGoogle}>
      <button type="submit" className="btn btn-primary btn-lg w-full">
        Continue with Google
      </button>
    </form>
  );
}

type HandoffStatus = { id: string; confirmCode: string; status: "pending" | "ready" };

function HomeScreenGoogleSignIn() {
  const [handoff, setHandoff] = useState<HandoffStatus | null>(null);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    let stop = false;
    async function load() {
      const current = await fetch("/api/auth/pwa-handoff").catch(() => null);
      if (stop) return;
      if (current?.ok) {
        const body = (await current.json()) as HandoffStatus;
        setHandoff(body);
        return;
      }
      const created = await fetch("/api/auth/pwa-handoff", { method: "POST" }).catch(() => null);
      if (stop) return;
      if (!created?.ok) {
        setError(
          created?.status === 429
            ? "Too many attempts. Wait a moment and try again."
            : "Could not start Google sign-in. Try again."
        );
        return;
      }
      setHandoff((await created.json()) as HandoffStatus);
    }
    void load();
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    if (!handoff || handoff.status === "ready") return;
    let stop = false;
    async function poll() {
      const response = await fetch("/api/auth/pwa-handoff").catch(() => null);
      if (stop || !response?.ok) return;
      const body = (await response.json()) as HandoffStatus;
      setHandoff((current) => (current?.status === body.status && current.id === body.id ? current : body));
    }
    const timer = window.setInterval(() => void poll(), 1500);
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [handoff]);

  useEffect(() => {
    if (handoff?.status !== "ready") return;
    let stop = false;
    void (async () => {
      const claimed = await fetch("/api/auth/pwa-claim", { method: "POST" }).catch(() => null);
      if (claimed?.ok) {
        window.location.replace("/");
        return;
      }
      if (stop) return;
      setError("That sign-in expired. Try Google again.");
      const created = await fetch("/api/auth/pwa-handoff", { method: "POST" }).catch(() => null);
      if (stop || !created?.ok) return;
      setHandoff((await created.json()) as HandoffStatus);
    })();
    return () => {
      stop = true;
    };
  }, [handoff?.status]);

  return (
    <div className="space-y-4">
      {handoff && (
        <p className="text-3xl font-semibold tracking-[0.3em]" aria-label={`Sign-in code ${handoff.confirmCode}`}>
          {handoff.confirmCode}
        </p>
      )}
      {handoff ? (
        <a
          className="btn btn-primary btn-lg w-full"
          href={`/login/pwa?handoff=${handoff.id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setWaiting(true)}
        >
          Continue with Google
        </a>
      ) : (
        <button type="button" className="btn btn-primary btn-lg w-full" disabled>
          Continue with Google
        </button>
      )}
      {waiting && !error && (
        <p className="text-sm text-muted" role="status">
          Waiting for Safari. Continue there only if the code matches.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
