import LogoutButton from "@/components/LogoutButton";
import { getAppSession } from "@/lib/app-session";
import { authMode } from "@/lib/flags";
import { accountIdentity } from "@/lib/principal";

export default async function SettingsPage() {
  const google = authMode() === "google";
  const session = await getAppSession();
  const identity = session ? accountIdentity(session) : null;
  return (
    <div className="space-y-6 py-6">
      <h1 className="text-3xl font-bold tracking-tight">Settings</h1>

      {identity && (
        <section className="card max-w-3xl space-y-2 p-5" aria-labelledby="account-heading">
          <h2 id="account-heading" className="eyebrow">Account</h2>
          <p className="text-lg font-semibold text-foreground">{identity.email}</p>
          <p className="text-sm font-medium text-foreground">{identity.roleLabel}</p>
          <p className="text-sm text-muted">{identity.detail}</p>
        </section>
      )}

      <section className="card max-w-3xl space-y-3 p-5 text-sm leading-relaxed text-muted">
        <h2 className="eyebrow">Tips</h2>
        <p>
          <strong className="text-foreground">iPhone and iPad:</strong> open this site in
          Safari, tap Share → Add to Home Screen to install it as an app. The installed app has
          its own login, so {google ? "sign in with Google once there" : "enter the password once there"}. It works in portrait, landscape,
          and Split View.
        </p>
        <p>
          <strong className="text-foreground">Apple Pencil:</strong> in Write Chinese and Write
          Pinyin, handwrite straight into the answer field with Scribble, then tap Check answer.
          For characters, add Chinese under Settings → Apple Pencil → Scribble (or a Chinese
          keyboard). In Normal Review, swipe the card left or right to move between words.
        </p>
        <p>
          <strong className="text-foreground">Keyboard shortcuts (Mac, or iPad with a keyboard):</strong> Space =
          reveal · 1 = Retry · 2 = Hard · 3 = Good · 4 = Easy · Space/Enter after reveal =
          Good · ←/→ = previous/next in normal mode. In Write mode, Enter checks your
          answer, then Enter again continues.
        </p>
        <p>
          <strong className="text-foreground">Pronunciation:</strong> speech uses your
          device&apos;s built-in voices. On iPhone, check the mute switch if you hear nothing;
          you can add higher-quality voices in Settings → Accessibility → Spoken Content →
          Voices.
        </p>
      </section>

      <LogoutButton />
    </div>
  );
}
