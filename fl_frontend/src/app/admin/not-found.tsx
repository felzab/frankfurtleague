"use client";

import Link from "next/link";

import { ctaButton } from "@/shared/components/ui/formButtons";
import { StatusPanel } from "@/shared/components/ui/StatusPanel";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";

// Scoped to `/admin` so a notFound() renders inside the admin shell: the next boundary up is the
// public one, which answers an administrator with the visitor's navigation and footer.
export default function AdminNotFound() {
  // The season is still on the url the 404 was served for, so the way out keeps it.
  const saisonHref = useSaisonHref();

  return (
    <StatusPanel
      // `inline` rather than `page`: the shell above already carries the route's h1.
      variant="inline"
      tone="warning"
      badgeLabel="Abseits"
      heading="Diese Seite existiert nicht."
      // Both arrivals: a `notFound()` from a matched segment, and a mistyped address the catch-all
      // beside this file hands over (`docs/frontend/spec.md :: I232`).
      message="Der Eintrag wurde gelöscht, oder die Adresse stimmt nicht.">
      <Link
        href={saisonHref("/admin")}
        prefetch={false}
        className={`${ctaButton({ intent: "primary", hover: "css" })} mt-8`}>
        Zur Verwaltung
      </Link>
    </StatusPanel>
  );
}
