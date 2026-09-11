import Link from "next/link";

import { DISPLAY_HEADING } from "@/shared/components/ui/displayType";
import { ctaButton } from "@/shared/components/ui/formButtons";

// Scoped to (shared-views) so a notFound() renders inside the dashboard shell: the next boundary
// up is the full-viewport 404, which would replace the sidemenu and season selector.
export default function TeamNotFound() {
  return (
    <div className="flex w-full flex-col items-center gap-y-4 py-16 text-center">
      <h2 className={`${DISPLAY_HEADING} fluid-xl text-foreground`}>Team nicht gefunden</h2>
      <p className="muted-hint">Dieses Team existiert nicht oder nimmt an der gewählten Saison nicht teil.</p>
      <Link
        href="/dashboard/teams"
        prefetch={false}
        className={ctaButton({ intent: "primary", hover: "css" })}>
        Zur Team-Übersicht
      </Link>
    </div>
  );
}
