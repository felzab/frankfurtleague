import Link from "next/link";

import { ctaButton } from "@/shared/components/ui/formButtons";
import { StatusPanel } from "@/shared/components/ui/StatusPanel";

import { zieleOf } from "../../utils";

import type { Funktion } from "@/core/funktionen";

/**
 * A team and season the person holds no seat on. It names nothing of the address — who holds a seat
 * there, or whether the team or the season exists — and sends the person only to what they hold.
 */
export function TeamForbiddenPanel({ funktionen }: { funktionen: readonly Funktion[] }) {
  // One way out per team and season, however many seats there lead to it.
  const wege = zieleOf(funktionen.filter((funktion) => funktion.art === "kontakt")).flatMap(({ href, funktionen: [erste] }) =>
    erste.art === "kontakt" ? [{ href: href, label: `${erste.team_name}, Saison ${erste.saison_id}` }] : [],
  );
  const links = wege.length === 0 ? [{ href: "/bereich", label: "Zu Deinem Bereich" }] : wege;
  // The brand fill on a sole way out; several are peers, and `outline` is a peer's grade.
  const intent = links.length === 1 ? "primary" : "outline";

  return (
    <StatusPanel
      // `inline` rather than `page`: the shell above already carries the route's h1.
      variant="inline"
      tone="warning"
      badgeLabel="Tribüne"
      heading="Hier bist Du nicht eingetragen."
      message="Für dieses Team in dieser Saison hast Du keine Funktion.">
      <div className="mt-8 flex w-full flex-col gap-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            prefetch={false}
            className={ctaButton({ intent: intent, hover: "css" })}>
            {link.label}
          </Link>
        ))}
      </div>
    </StatusPanel>
  );
}
