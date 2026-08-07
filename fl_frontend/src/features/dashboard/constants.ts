/**
 * DASHBOARD · navigation structure
 *
 * The public dashboard sidemenu, and the icon dictionary it is validated against. Kept in one file so
 * the two cannot disagree.
 */

import { Calendar, ClockArrowRotateLeft, LayoutHeaderCells, Magnifier, Medal, Person, Persons } from "@gravity-ui/icons";

import type { SidemenuStructure } from "@/shared/types/types";
import type React from "react";

/**
 * The icon dictionary lives beside the structure it must agree with, and `DashboardIconName` is
 * derived from it — so an `iconName` typo below is a compile error instead of a nav item that
 * silently renders without an icon.
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
 * `label` is what the nav item and the shell's page title both read, and `hint` is what the info
 * glyph beside that title says — so a route's name and its explanation are declared once, together,
 * rather than at the top of whichever view happens to render it.
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
          points: [
            { term: "Gesucht wird in", detail: "Mannschaft, Ort, Datum, Spielnummer und Schiedsrichter." },
            { term: "Sofort", detail: "die Liste filtert beim Tippen, es gibt nichts abzuschicken." },
          ],
          note: "Gesucht wird nur innerhalb der gewählten Saison.",
        },
      },
      {
        id: "spielhistorie",
        label: "Spielhistorie",
        iconName: "ClockArrowRotateLeft",
        hint: {
          lead: "Alle bereits gespielten Begegnungen der Saison.",
          points: [{ term: "Reihenfolge", detail: "die zuletzt gespielten zuerst." }],
          note: "Was noch aussteht, steht im Spielplan.",
        },
      },
      {
        id: "spielplan",
        label: "Spielplan",
        iconName: "Calendar",
        hint: {
          lead: "Der komplette Spielplan der Saison.",
          points: [
            { term: "Spieltage", detail: "jeder Reiter oben ist ein Spieltag." },
            { term: "Je Begegnung", detail: "Datum, Uhrzeit, Ort und, sobald gewertet, das Ergebnis." },
          ],
        },
      },
      {
        id: "playoffs",
        label: "Finalrunden",
        iconName: "Medal",
        hint: {
          lead: "Der Turnierbaum der Finalrunden, von der ersten KO.-Runde bis zum Finale.",
          points: [
            { term: "Linien", detail: "verbinden ein Spiel mit dem, aus dem sein Sieger kommt." },
            { term: "Offene Seiten", detail: "zeigen ihre Herkunft statt einer Mannschaft, etwa „Sieger 25.“." },
          ],
          note: "Die Runden entstehen erst, wenn die Gruppenphase abgeschlossen ist.",
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
          points: [
            { term: "Gewertet", detail: "werden ausschließlich Spiele der Gruppenphase." },
            { term: "Hervorgehoben", detail: "sind die Mannschaften, die aktuell auf einem KO.-Runden-Platz stehen." },
          ],
          note: "Die Gesamtbilanz einer Mannschaft steht auf ihrer eigenen Seite.",
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
          lead: "Alle Mannschaften der laufenden Saison.",
          points: [{ term: "Eine Mannschaft öffnen", detail: "zeigt ihre Bilanz, ihren Kader und ihren Saisonverlauf." }],
        },
      },
      {
        id: "spieler",
        label: "Spieler",
        iconName: "Person",
        hint: {
          lead: "Die Kader aller Mannschaften der Saison.",
          points: [{ term: "Eine Mannschaft öffnen", detail: "zeigt die Spielerinnen und Spieler mit Position und Stufe." }],
        },
      },
    ],
  },
];
