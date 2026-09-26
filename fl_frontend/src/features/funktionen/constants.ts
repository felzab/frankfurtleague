import House from "@gravity-ui/icons/House";
import Person from "@gravity-ui/icons/Person";
import PersonPencil from "@gravity-ui/icons/PersonPencil";

import type { SidemenuHint, SidemenuStructure, SidemenuStructureSubOption } from "@/shared/types/types";
import type React from "react";

/** `PersonIconName` is derived from this, so an `iconName` typo below is a compile error. */
export const PERSON_SIDEMENU_ICONS = {
  House,
  // The admin's glyph for each of the two records, so one record wears one glyph on both sides.
  PersonPencil,
  Person,
} as const satisfies Record<string, React.ElementType>;

export type PersonIconName = keyof typeof PERSON_SIDEMENU_ICONS;

/** What the bar reads on an address inside `/bereich` that no page claims, the catch-all's 404 among them. */
export const PERSON_SHELL_FALLBACK = {
  label: "Dein Bereich",
  hint: {
    lead: "Diese Adresse gehört zu keiner Seite Deines Bereichs.",
  },
} as const satisfies { label: string; hint: SidemenuHint };

/** Which of the person shell's entries a person may be shown: the landing, and one per person-lane page. */
export type PersonEintrag = "landing" | "spieler" | "schiedsrichter";

/**
 * Every entry the person shell can list, in the order it lists them. `personStructureFor` selects
 * from this table and composes nothing, so every entry a person can be shown is readable here.
 */
export const PERSON_SIDEMENU_ENTRIES = {
  landing: {
    // The prefix itself: `/bereich` is the switch between every Funktion a person holds.
    id: "",
    label: "Übersicht",
    iconName: "House",
    hint: {
      lead: "Alles, wofür Du bei der Frankfurt League eingetragen bist.",
    },
  },
  spieler: {
    id: "spieler",
    label: "Spieler",
    iconName: "PersonPencil",
    hint: {
      lead: "Dein Eintrag im Kader Deines Teams.",
    },
  },
  schiedsrichter: {
    id: "schiedsrichter",
    label: "Schiedsrichter",
    iconName: "Person",
    hint: {
      lead: "Die Spiele, die Dir als Schiedsrichter zugeteilt sind.",
    },
  },
} as const satisfies Record<PersonEintrag, SidemenuStructureSubOption<PersonIconName>>;

/**
 * The person shell's one unnamed group, narrowed to `eintraege`. An entry for a page the person may
 * not open is a link the page refuses, so a caller passes only what the person holds.
 */
export function personStructureFor(eintraege: ReadonlySet<PersonEintrag>): SidemenuStructure<PersonIconName> {
  const sub_options = (Object.keys(PERSON_SIDEMENU_ENTRIES) as PersonEintrag[])
    .filter((eintrag) => eintraege.has(eintrag))
    .map((eintrag) => PERSON_SIDEMENU_ENTRIES[eintrag]);

  // No group at all rather than an empty one: `SidemenuNavLinks` keys a group on its first entry.
  return sub_options.length === 0 ? [] : [{ category_name: "", sub_options: sub_options }];
}

/** `TeamIconName` is derived from this, so an `iconName` typo below is a compile error. */
export const TEAM_SIDEMENU_ICONS = {
  House,
} as const satisfies Record<string, React.ElementType>;

export type TeamIconName = keyof typeof TEAM_SIDEMENU_ICONS;

/** What the bar reads on an address inside a team's area that no page claims, the catch-all's 404 among them. */
export const TEAM_SHELL_FALLBACK = {
  label: "Teambereich",
  hint: {
    lead: "Diese Adresse gehört zu keiner Seite Deines Teams.",
  },
} as const satisfies { label: string; hint: SidemenuHint };

/**
 * Every entry the team shell can list, in the order it lists them. A page arriving later is a row here
 * and nothing more: every seat reaches every entry, so no row carries a seat rule.
 */
export const TEAM_SIDEMENU_ENTRIES = [
  {
    // The prefix itself: the team and season are the address, and the landing is the panel's start.
    id: "",
    label: "Übersicht",
    iconName: "House",
    hint: {
      lead: "Dein Team in dieser Saison und Deine Funktion darin.",
    },
  },
] as const satisfies readonly SidemenuStructureSubOption<TeamIconName>[];
