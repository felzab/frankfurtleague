import type { Funktion } from "@/core/funktionen";
import type { PersonEintrag } from "./constants";

/** The address one Funktion opens on. */
function funktionHref(funktion: Funktion): string {
  switch (funktion.art) {
    case "kontakt":
      return `/bereich/team/${funktion.team_id}/${funktion.saison_id}`;
    case "spieler":
      return "/bereich/spieler";
    case "schiedsrichter":
      return "/bereich/schiedsrichter";
    case "administration":
      // eslint-disable-next-line local/admin-link -- a Funktion's own address; no season is in scope where a person lands
      return "/bereich/admin";
  }
}

/** One address a person's Funktionen lead to, with every one of them that leads there. */
export type FunktionZiel = { href: string; funktionen: readonly [Funktion, ...Funktion[]] };

/**
 * Grouped by address rather than listed per Funktion: two pupil rows on one mailbox, or a Trainer
 * who is also the Ansprechperson, lead to one page, and two links to it would read as two places.
 */
export function zieleOf(funktionen: readonly Funktion[]): FunktionZiel[] {
  const byHref = new Map<string, [Funktion, ...Funktion[]]>();
  for (const funktion of funktionen) {
    const href = funktionHref(funktion);
    const held = byHref.get(href);
    if (held === undefined) byHref.set(href, [funktion]);
    else held.push(funktion);
  }

  return [...byHref].map(([href, held]) => ({ href: href, funktionen: held }));
}

/**
 * The person shell's entries for these Funktionen. The landing is left out exactly where it sends
 * the person straight on, so the entry is never a press that lands back where it started.
 */
export function personEintraegeOf(funktionen: readonly Funktion[]): ReadonlySet<PersonEintrag> {
  const eintraege = new Set<PersonEintrag>();
  if (zieleOf(funktionen).length !== 1) eintraege.add("landing");
  if (funktionen.some((funktion) => funktion.art === "spieler")) eintraege.add("spieler");
  if (funktionen.some((funktion) => funktion.art === "schiedsrichter")) eintraege.add("schiedsrichter");

  return eintraege;
}
