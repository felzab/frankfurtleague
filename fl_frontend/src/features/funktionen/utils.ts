import { joinUnd } from "@/core/joinUnd";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";

import { teamHref } from "./teamSeats";

import type { Funktion } from "@/core/funktionen";
import type { FunktionOrt } from "@/shared/components/layout/sidemenu/FunktionSwitcher";
import type { PersonEintrag } from "./constants";

/** The address one Funktion opens on. */
function funktionHref(funktion: Funktion): string {
  switch (funktion.art) {
    case "kontakt":
      return teamHref(funktion.team_id, funktion.saison_id);
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

/** One address's two lines: what it is, and which of the person's Funktionen lead there. */
export function zeilenOf(ziel: FunktionZiel): { titel: string; detail: string } {
  const [erste] = ziel.funktionen;

  switch (erste.art) {
    case "kontakt": {
      // Every seat at one address shares its team and season, so the first names both.
      const gehalten = new Set(ziel.funktionen.flatMap((funktion) => (funktion.art === "kontakt" ? [funktion.rolle] : [])));
      // In `KONTAKT_ROLLEN`'s order rather than the lookup's, so one person's roles read alike on every visit.
      const rollen = KONTAKT_ROLLEN.filter((rolle) => gehalten.has(rolle.value)).map((rolle) => rolle.label);
      return { titel: erste.team_name, detail: `Saison ${erste.saison_id} · ${joinUnd(rollen)}` };
    }
    case "spieler":
      return { titel: "Spieler", detail: "Dein Kadereintrag" };
    case "schiedsrichter":
      return { titel: "Schiedsrichter", detail: "Deine Einsätze" };
    case "administration":
      return { titel: "Verwaltung", detail: "Die Verwaltung der Liga" };
  }
}

/**
 * The places `FunktionSwitcher` lists, labelled as the landing's cards are, in the landing's order.
 * One place is no choice to offer, so the switcher shows only from two.
 */
export function funktionOrteOf(funktionen: readonly Funktion[]): FunktionOrt[] {
  return zieleOf(funktionen).map((ziel) => ({ href: ziel.href, ...zeilenOf(ziel) }));
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
