"use client";

import Link from "next/link";

import { useShellSaisonHref } from "@/shared/components/layout/shell/ShellSaisonQuery";

import { ctaButton } from "./formButtons";
import { StatusPanel } from "./StatusPanel";

/**
 * The not-found answer of an area that has a shell of its own.
 *
 * Both arrivals land here: a `notFound()` from a matched segment, and a mistyped address the area's
 * catch-all hands over (`docs/frontend/spec.md :: I232`).
 */
export function ShellNotFound({ message, href, linkLabel }: { message: string; href: string; linkLabel: string }) {
  // The way out links as the shell around it does, keeping the season where that shell's query holds it.
  const saisonHref = useShellSaisonHref();

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
