import { Calendar, ClockArrowRotateLeft, LayoutHeaderCells, Magnifier, Medal, Person, Persons } from "@gravity-ui/icons";

import type { SidemenuHint, SidemenuStructure } from "@/shared/types/types";
import type React from "react";

/**
 * `DashboardIconName` is derived from this, so an `iconName` typo below is a compile error rather
 * than a nav item that silently renders without an icon.
 */
export const DASHBOARD_SIDEMENU_ICONS = {
  Magnifier,
  ClockArrowRotateLeft,
  Calendar,
  Medal,
  LayoutHeaderCells,
  Persons,
  Person,
} as const satisfies Record<string, React.ElementType>;

export type DashboardIconName = keyof typeof DASHBOARD_SIDEMENU_ICONS;

/**
 * What the bar reads on `/dashboard` itself, which the nav does not name because every entry below is a section of it.
 */
export const DASHBOARD_SHELL_FALLBACK = {
  label: "Saisonübersicht",
  hint: {
    // The three group headings below, which is the whole of what the section holds.
    lead: "Alles zur ausgewählten Saison: Spiele, Tabellen und Teams.",
  },
} as const satisfies { label: string; hint: SidemenuHint };

/**
 * `label` is what the nav item and the shell's page title both read, and `hint` is what the info
 * glyph beside that title says — so a route's name and its explanation are declared once, together.
 */
export const DASHBOARD_SIDEMENU_STRUCTURE: SidemenuStructure<DashboardIconName> = [
  {
    category_name: "Spiele",
    sub_options: [
      {
        id: "spielsuche",
        label: "Spielsuche",
        iconName: "Magnifier",
        hint: {
          lead: "Durchsucht alle Spiele der ausgewählten Saison.",
          // The list is counted against what a visitor can reach (`docs/frontend/spec.md` §1.12): both
          // `ort.*` keys are the venue, so `Ort` names them once.
          points: [{ term: "Gesucht wird in", detail: "Team, Herkunft, Ort, Datum, Spielnummer und Schiedsrichter." }],
        },
      },
      {
        id: "spielplan",
        label: "Spielplan",
        iconName: "Calendar",
        hint: {
          lead: "Der komplette Spielplan der Saison.",
        },
      },
      {
        id: "playoffs",
        label: "Finalrunden",
        iconName: "Medal",
        hint: {
          lead: "Der Turnierbaum der Finalrunden.",
        },
      },
    ],
  },
  {
    category_name: "Tabellen",
    sub_options: [
      {
        id: "saisontabelle",
        label: "Saisontabelle",
        iconName: "LayoutHeaderCells",
        hint: {
          lead: "Der Tabellenstand jeder Gruppe der Saison.",
          note: "Die Gesamtbilanz eines Teams steht auf seiner eigenen Seite.",
        },
      },
    ],
  },
  {
    category_name: "Teams",
    sub_options: [
      {
        id: "teams",
        label: "Teams",
        iconName: "Persons",
        hint: {
          lead: "Alle Teams der Saison.",
        },
      },
      {
        id: "spieler",
        label: "Spieler",
        iconName: "Person",
        hint: {
          lead: "Die Kader aller Teams der Saison.",
        },
      },
    ],
  },
];
