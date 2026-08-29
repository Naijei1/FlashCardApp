import LogoutButton from "@/components/LogoutButton";

export default function SettingsPage() {
  return (
    <div className="space-y-6 py-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="space-y-3 rounded-2xl border border-border bg-surface p-4 text-sm text-muted">
        <h2 className="text-sm font-medium uppercase tracking-wide">Tips</h2>
        <p>
          <strong className="text-foreground">iPhone:</strong> open this site in Safari, tap
          Share → Add to Home Screen to install it as an app. The installed app has its own
          login, so enter the password once there.
        </p>
        <p>
          <strong className="text-foreground">Keyboard shortcuts (review):</strong> Space =
          reveal · 1 = Again · 2 = Hard · 3 = Good · 4 = Easy · ←/→ = previous/next in study
          mode.
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
