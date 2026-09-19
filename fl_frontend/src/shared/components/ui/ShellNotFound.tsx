"use client";

import Link from "next/link";

import { useSaisonHref } from "@/shared/hooks/useSaisonHref";

import { ctaButton } from "./formButtons";
import { StatusPanel } from "./StatusPanel";

/**
 * The not-found answer of an area that has a shell of its own.
 *
 * Both arrivals land here: a `notFound()` from a matched segment, and a mistyped address the area's
 * catch-all hands over (`docs/frontend/spec.md :: I232`).
 */
export function ShellNotFound({ message, href, linkLabel }: { message: string; href: string; linkLabel: string }) {
  // The season is still on the url the 404 was served for, so the way out keeps it.
  const saisonHref = useSaisonHref();

  return (
    <StatusPanel
      // `inline` rather than `page`: the shell above already carries the route's h1.
      variant="inline"
      tone="warning"
      badgeLabel="Abseits"
      heading="Diese Seite existiert nicht."
      message={message}>
      <Link
        href={saisonHref(href)}
        prefetch={false}
        className={`${ctaButton({ intent: "primary", hover: "css" })} mt-8`}>
        {linkLabel}
      </Link>
    </StatusPanel>
  );
}
