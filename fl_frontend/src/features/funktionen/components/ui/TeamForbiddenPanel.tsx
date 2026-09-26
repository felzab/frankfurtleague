import Link from "next/link";

import { ctaButton } from "@/shared/components/ui/formButtons";
import { NAME_WRAP_CLASSES } from "@/shared/components/ui/nameWrap";
import { StatusPanel } from "@/shared/components/ui/StatusPanel";

import { zieleOf } from "../../utils";

import type { Funktion } from "@/core/funktionen";

const BEREICH = { href: "/bereich", label: "Zu Deinem Bereich" };

/**
 * A team and season the person holds no seat on. It names nothing of the address — who holds a seat
 * there, or whether the team or the season exists — and sends the person only to what they hold.
 */
export function TeamForbiddenPanel({ funktionen }: { funktionen: readonly Funktion[] }) {
  // One way out per team and season, however many seats there lead to it.
  const sitze = zieleOf(funktionen.filter((funktion) => funktion.art === "kontakt")).flatMap(({ href, funktionen: [erste] }) =>
    erste.art === "kontakt" ? [{ href: href, label: `${erste.team_name}, Saison ${erste.saison_id}` }] : [],
  );
  const links = sitze.length === 0 ? [BEREICH] : sitze;

  // A sole way out at its own width and in the brand fill, as every other panel under a shell shows
  // one; several are peers, in a peer's outline grade and stacked at the panel's width.
  if (links.length === 1)
    return (
      <Panel>
        <div className="mt-8">{wegOf(links[0]!, "primary")}</div>
      </Panel>
    );

  return (
    <Panel>
      <div className="mt-8 flex w-full flex-col gap-3">{links.map((link) => wegOf(link, "outline"))}</div>
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <StatusPanel
      // `inline` rather than `page`: the shell above already carries the route's h1.
      variant="inline"
      tone="warning"
      badgeLabel="Tribüne"
      heading="Hier bist Du nicht eingetragen."
      message="Für dieses Team in dieser Saison hast Du keine Funktion.">
      {children}
    </StatusPanel>
  );
}

function wegOf(link: { href: string; label: string }, intent: "primary" | "outline") {
  return (
    <Link
      key={link.href}
      href={link.href}
      prefetch={false}
      // `wraps`, as a club's name is whatever the club is called and a phone's width may not seat it.
      className={ctaButton({ intent: intent, hover: "css", wraps: true })}>
      <span className={NAME_WRAP_CLASSES}>{link.label}</span>
    </Link>
  );
}
