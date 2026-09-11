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
      badgeLabel="Abseits"
      heading="Dieser Eintrag existiert nicht."
      // An unmatched admin address never reaches this boundary (`docs/frontend/spec.md :: I232`), so
      // the message names only what a `notFound()` inside a matched segment answers for.
      message="Er wurde gelöscht, oder die Adresse stimmt nicht.">
      <Link
        href={saisonHref("/admin")}
        prefetch={false}
        className={`${ctaButton({ intent: "primary", hover: "css" })} mt-8`}>
        Zur Verwaltung
      </Link>
    </StatusPanel>
  );
}
