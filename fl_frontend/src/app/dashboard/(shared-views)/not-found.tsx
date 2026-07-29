import Link from "next/link";

// Scoped to (shared-views) so notFound() from either [team_id] route renders inside the dashboard
// shell. Without it the nearest boundary is app/not-found.tsx, whose full-viewport 404 replaces
// the sidemenu and season selector and offers only "Zur Startseite" as a way back.
export default function TeamNotFound() {
  return (
    <div className="flex w-full flex-col items-center gap-y-4 py-16 text-center">
      <h2 className="text-fluid-xl text-foreground font-extrabold tracking-tight">Team nicht gefunden</h2>
      <p className="text-fluid-sm text-foreground-muted font-medium">
        Dieses Team existiert nicht oder nimmt an der gewählten Saison nicht teil.
      </p>
      <Link
        href="/dashboard/teams"
        prefetch={false}
        // text-white, not text-foreground: --fg-base is near-black in the light theme, which is
        // 1.97:1 on the brand fill. White is 10.03:1 in both themes.
        className="text-fluid-sm bg-brand-solid mt-2 rounded-xl px-6 py-3 font-bold text-white transition-all hover:scale-[1.02]">
        Zur Team-Übersicht
      </Link>
    </div>
  );
}
