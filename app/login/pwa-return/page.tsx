import CloseAuthSheet from "@/components/CloseAuthSheet";
import { googleSignInError } from "@/lib/google-sign-in-error";
import { readGoogleAuthState } from "@/lib/google-auth";
import { HANDOFF_ID, handoffIsCurrent } from "@/lib/pwa-handoff";
import { dynamoPwaAuthStore } from "@/lib/pwa-handoff-db";

export const dynamic = "force-dynamic";

export default async function PwaReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ handoff?: string; error?: string; done?: string }>;
}) {
  const params = await searchParams;
  const handoff = params.handoff && HANDOFF_ID.test(params.handoff) ? params.handoff : "";
  const retry = handoff ? `/login/pwa?handoff=${handoff}` : "/login";
  if (params.error || !handoff) {
    return (
      <Sheet message={googleSignInError(params.error) || "This sign-in expired. Close this window and try again from the app."}>
        {handoff && (
          <a className="btn btn-primary btn-lg w-full" href={retry}>
            Try Google again
          </a>
        )}
      </Sheet>
    );
  }

  const record = await dynamoPwaAuthStore.readHandoff(handoff).catch(() => null);
  if (!record || !handoffIsCurrent(record, Date.now())) {
    return (
      <Sheet message="This sign-in expired. Close this window and try again from the app.">
        <a className="btn btn-primary btn-lg w-full" href={retry}>
          Try Google again
        </a>
      </Sheet>
    );
  }

  if (params.done === "1") {
    return (
      <Sheet message="Signed in. Close this window and return to the Flashcards icon on your Home Screen.">
        <CloseAuthSheet />
        <Code value={record.confirmCode} />
      </Sheet>
    );
  }

  const session = await readGoogleAuthState().catch(() => null);
  if (!session) {
    return (
      <Sheet message="Google didn't finish signing in. Close this window and try again from the app.">
        <a className="btn btn-primary btn-lg w-full" href={retry}>
          Try Google again
        </a>
      </Sheet>
    );
  }

  return (
    <Sheet message="Continue only if this code matches the one in the Flashcards app.">
      <Code value={record.confirmCode} />
      {session.email && <p className="text-sm text-muted">{session.email}</p>}
      <form method="POST" action="/api/auth/pwa-deposit" className="w-full">
        <input type="hidden" name="handoff" value={handoff} />
        <button type="submit" className="btn btn-primary btn-lg w-full">
          Continue
        </button>
      </form>
    </Sheet>
  );
}

function Sheet({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 pt-safe pb-safe">
      <div className="w-full max-w-xs space-y-4 text-center">
        <div className="hanzi-text text-5xl leading-tight">学</div>
        <h1 className="text-xl font-semibold">Chinese Flashcards</h1>
        <p className="text-sm text-muted">{message}</p>
        {children}
      </div>
    </main>
  );
}

function Code({ value }: { value: string }) {
  return (
    <p className="text-3xl font-semibold tracking-[0.3em]" aria-label={`Sign-in code ${value}`}>
      {value}
    </p>
  );
}
