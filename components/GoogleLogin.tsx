import { signInWithGoogle } from "@/app/login/actions";

export default function GoogleLogin({ error }: { error?: string }) {
  const message =
    error === "AccessDenied"
      ? "Google must confirm your email before you can sign in."
      : error === "TooManyAttempts"
        ? "Too many attempts. Wait a moment and try again."
        : error
          ? "Could not sign in with Google. Try again."
          : "";
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 pt-safe pb-safe">
      <form action={signInWithGoogle} className="w-full max-w-xs space-y-4 text-center">
        <div className="hanzi-text text-5xl leading-tight">学</div>
        <h1 className="text-xl font-semibold">Chinese Flashcards</h1>
        <p className="text-sm text-muted">
          Sign in with Google. New accounts can study right away. The admin account manages weekly decks and does not study.
        </p>
        {message && <p role="alert" className="text-sm text-red-500">{message}</p>}
        <button type="submit" className="btn btn-primary btn-lg w-full">
          Continue with Google
        </button>
      </form>
    </main>
  );
}
