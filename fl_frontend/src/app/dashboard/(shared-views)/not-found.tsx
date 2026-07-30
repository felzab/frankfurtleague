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
        className="text-fluid-sm bg-brand-solid text-brand-solid-foreground hover:scale-hover mt-2 rounded-xl px-6 py-3 font-bold transition-all duration-200">
        Zur Team-Übersicht
      </Link>
    </div>
  );
}
