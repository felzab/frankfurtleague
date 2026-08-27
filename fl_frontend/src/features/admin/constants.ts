import {
  Calendar,
  ClockArrowRotateLeft,
  ExclamationShape,
  Magnifier,
  MapPin,
  Medal,
  Person,
  PersonPencil,
  Persons,
  Sliders,
} from "@gravity-ui/icons";

import type { SidemenuHint, SidemenuStructure } from "@/shared/types/types";
import type React from "react";

/**
 * `AdminIconName` is derived from this, so an `iconName` typo below is a compile error rather than a
 * nav item that silently renders without an icon.
 */
export const ADMIN_SIDEMENU_ICONS = {
  ExclamationShape,
  Magnifier,
  Medal,
  Person,
  PersonPencil,
  Persons,
  MapPin,
  // The season's glyph, never a calendar — that is the Spieltage entry's below.
  Sliders,
  Calendar,
  ClockArrowRotateLeft,
} as const satisfies Record<string, React.ElementType>;

export type AdminIconName = keyof typeof ADMIN_SIDEMENU_ICONS;

/**
 * What the bar reads on `/admin/spiele/[spiel_id]`, the one route no nav entry names. It gets no entry of its own
 * because the nav renders a link per entry and there is no fixture index to link to.
 */
export const ADMIN_SHELL_FALLBACK = {
  label: "Spiele",
  hint: {
    lead: "Ein einzelnes Spiel bearbeiten.",
  },
} as const satisfies { label: string; hint: SidemenuHint };

export const ADMIN_SIDEMENU_STRUCTURE: SidemenuStructure<AdminIconName> = [
  // Deliberately unnamed: everything below is season-scoped, and `SidemenuNavLinks` renders neither a
  // label nor a rule for an empty name.
  {
    category_name: "",
    sub_options: [
      {
        id: "saisons",
        label: "Saisons",
        iconName: "Sliders",
        hint: {
          lead: "Alle Saisons, mit Zeitraum und Regeln.",
          // What an admin comes here to do and cannot: no row carries a delete control, and none ever will.
          note: "Eine Saison wird nie gelöscht.",
        },
      },
    ],
  },

  {
    category_name: "Spiele",
    sub_options: [
      {
        id: "action_required",
        label: "Handlungsbedarf",
        iconName: "ExclamationShape",
        hint: {
          // No list of the categories: the page's own hint reads the active tab's
          // `ACTION_REQUIRED_LABELS` entry, and a second telling here would go stale against it.
          lead: "Jedes Spiel, das eine Eingabe braucht, sortiert nach dem, was es aufhält.",
          note: "Ein abgebrochenes Spiel wartet weiter auf sein Ergebnis.",
        },
      },
      {
        id: "spielsuche",
        label: "Spielsuche",
        iconName: "Magnifier",
        hint: {
          lead: "Alle Spiele der Saison.",
          points: [
            // Herkunft is searched as the label a reader sees — „Sieger 25.“ finds the fixture fed
            // by match 25, which no other term here would.
            { term: "Gesucht werden kann nach", detail: "Team, Herkunft, Ort, Datum, Spielnummer und Schiedsrichter." },
          ],
        },
      },
      {
        id: "spieltage",
        label: "Spieltage",
        iconName: "Calendar",
        hint: {
          lead: "Die Spieltage der Saison.",
          // What an admin comes here to do and cannot: this list has no create control, and the
          // draw that makes a Spieltag is on the season page.
          note: "Spieltage entstehen zusammen mit dem Spielplan.",
        },
      },
      {
        id: "finalrunden",
        label: "Finalrunden",
        iconName: "Medal",
        // The caption legend lives in the shell's hint and not on the page, so the surface has one
        // info glyph rather than two answers to one question.
        hint: {
          lead: "Woher jede Seite jedes KO-Spiels kommt.",
          // Every caption a reader can reach, so none on the page is missing here.
          // `fl_frontend/src/features/admin/components/views/AdminBracketWiringView.tsx :: SlotWiring`'s
          // fallback for a source `formatQuelle` cannot read is unreachable on a stored fixture.
          points: [
            { term: "„1. der Gruppe A“", detail: "aus der Tabelle gesetzt." },
            // Both outcomes, because `formatQuelle` spells the other seat „Verlierer 25.“ and a legend
            // naming only the winner leaves that caption unexplained on the page.
            { term: "„Sieger 25.“ und „Verlierer 25.“", detail: "aus einem früheren Spiel." },
            { term: "„Manuell gesetzt“", detail: "von Hand besetzt." },
            { term: "„Ohne Herkunft“", detail: "diese Seite füllt niemand." },
          ],
        },
      },
    ],
  },

  {
    category_name: "Infrastruktur",
    sub_options: [
      {
        id: "spielorte",
        label: "Spielorte",
        iconName: "MapPin",
        hint: {
          lead: "Alle Austragungsorte, mit Adresse und Miete.",
        },
      },
    ],
  },
  {
    category_name: "Beteiligte",
    sub_options: [
      {
        id: "teams",
        label: "Teams",
        iconName: "Persons",
        hint: {
          // The appositive rather than the columns: the list spans every season, while what each row
          // shows beside the name is the selected season's.
          lead: "Alle Teams über alle Saisons, mit den Angaben der gewählten Saison.",
        },
      },
      {
        id: "spieler",
        label: "Spieler",
        iconName: "PersonPencil",
        hint: {
          // The Teams entry's appositive, for the same reason it is written there.
          lead: "Alle Spieler über alle Saisons, mit den Angaben der gewählten Saison.",
        },
      },
      {
        id: "schiedsrichter",
        label: "Schiedsrichter",
        iconName: "Person",
        hint: {
          lead: "Alle Schiedsrichter, mit Kontakt und Honorar.",
        },
      },
    ],
  },

  {
    category_name: "System",
    sub_options: [
      {
        id: "aktionen",
        label: "Änderungsprotokoll",
        iconName: "ClockArrowRotateLeft",
        hint: {
          lead: "Jede Änderung aus der Verwaltung.",
          // What a row shows but cannot explain from itself. The columns are deliberately not
          // listed: a partial column list reads as the whole table.
          points: [
            { term: "„System“", detail: "steht für eine Änderung ohne Anmeldung." },
            { term: "Die Vorgangsnummer", detail: "fasst die Zeilen eines Speicherns zusammen." },
          ],
          note: "Von hier aus lässt sich nichts zurücknehmen.",
        },
      },
    ],
  },
];
