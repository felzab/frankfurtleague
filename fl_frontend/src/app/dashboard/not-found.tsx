"use client";

import Link from "next/link";

import { ctaButton } from "@/shared/components/ui/formButtons";
import { StatusPanel } from "@/shared/components/ui/StatusPanel";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";

// At `dashboard/` rather than in a route group below it: a boundary inside a group answers that
// group alone, and every other dashboard route would fall through to the root one, under the
// visitor's chrome.
export default function DashboardNotFound() {
  // The season is still on the url the 404 was served for, so the way out keeps it.
  const saisonHref = useSaisonHref();

  return (
    <StatusPanel
      // `inline` rather than `page`: the shell above already carries the route's h1.
      variant="inline"
      badgeLabel="Abseits"
      heading="Diese Seite existiert nicht."
      // Both arrivals: a `notFound()` from a matched segment, and a mistyped address the catch-all
      // beside this file hands over (`docs/frontend/spec.md :: I232`).
      message="Sie gehört nicht zur gewählten Saison, oder die Adresse stimmt nicht.">
      <Link
        href={saisonHref("/dashboard")}
        prefetch={false}
        className={`${ctaButton({ intent: "primary", hover: "css" })} mt-8`}>
        Zur Saisonübersicht
      </Link>
    </StatusPanel>
  );
}
