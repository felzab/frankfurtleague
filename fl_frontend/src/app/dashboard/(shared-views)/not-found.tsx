import Link from "next/link";

import { ctaButton } from "@/shared/components/ui/formButtons";

// Scoped to (shared-views) so notFound() from either [team_id] route renders inside the dashboard
// shell. Without it the nearest boundary is app/not-found.tsx, whose full-viewport 404 replaces the
// sidemenu and season selector.
export default function TeamNotFound() {
  return (
    <div className="flex w-full flex-col items-center gap-y-4 py-16 text-center">
      <h2 className="fluid-xl text-foreground font-extrabold tracking-tight">Team nicht gefunden</h2>
      <p className="fluid-sm text-foreground-muted font-medium">Dieses Team existiert nicht oder nimmt an der gewählten Saison nicht teil.</p>
      <Link
        href="/dashboard/teams"
        prefetch={false}
        className={`${ctaButton({ intent: "primary" })} mt-2`}>
        Zur Team-Übersicht
      </Link>
    </div>
  );
}
