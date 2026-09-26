import Ban from "@gravity-ui/icons/Ban";
import Calendar from "@gravity-ui/icons/Calendar";
import ClockArrowRotateLeft from "@gravity-ui/icons/ClockArrowRotateLeft";
import Envelope from "@gravity-ui/icons/Envelope";
import ExclamationShape from "@gravity-ui/icons/ExclamationShape";
import Magnifier from "@gravity-ui/icons/Magnifier";
import MapPin from "@gravity-ui/icons/MapPin";
import Medal from "@gravity-ui/icons/Medal";
import Person from "@gravity-ui/icons/Person";
import PersonPencil from "@gravity-ui/icons/PersonPencil";
import Persons from "@gravity-ui/icons/Persons";
import Sliders from "@gravity-ui/icons/Sliders";
import Tray from "@gravity-ui/icons/Tray";

import type { SidemenuHint, SidemenuStructure } from "@/shared/types/types";
import type React from "react";

/**
 * `AdminIconName` is derived from this, so an `iconName` typo below is a compile error rather than a
 * nav item that silently renders without an icon.
 */
export const ADMIN_SIDEMENU_ICONS = {
  ExclamationShape,
  Envelope,
  Magnifier,
  Medal,
  Person,
  PersonPencil,
  Persons,
  MapPin,
  // The triage's glyph: an in-tray of applications waiting to be worked down.
  Tray,
  // The season's glyph, never a calendar — that is the Spieltage entry's below.
  Sliders,
  Calendar,
  ClockArrowRotateLeft,
  Ban,
} as const satisfies Record<string, React.ElementType>;

export type AdminIconName = keyof typeof ADMIN_SIDEMENU_ICONS;

/**
 * What the bar reads on an address that belongs to no section, the catch-all's 404 among them. The area's name, never a
 * section's: a heading naming one describes a page the reader is not on (WCAG 2.4.6).
 */
export const ADMIN_SHELL_FALLBACK = {
  label: "Verwaltung",
  hint: {
    lead: "Diese Adresse gehört zu keinem Bereich der Verwaltung.",
  },
} as const satisfies { label: string; hint: SidemenuHint };

/** `/bereich/admin/spiele/[spiel_id]` gets no nav entry: the nav renders a link per entry, and there is no fixture index to link to. */
export const ADMIN_SHELL_UNLISTED_SECTIONS = {
  spiele: {
    label: "Spiele",
    hint: {
      lead: "Ein einzelnes Spiel bearbeiten.",
    },
  },
} as const satisfies Readonly<Record<string, { label: string; hint: SidemenuHint }>>;

export const ADMIN_SIDEMENU_STRUCTURE: SidemenuStructure<AdminIconName> = [
  // Deliberately unnamed: a season is created and edited here, which makes this the subject the menu
  // is organised under rather than one more group in it. `SidemenuNavLinks` renders neither a label
  // nor a rule for an empty name.
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

  // Grouped by what an admin DOES here: both are queues worked down to nothing, where every list
  // below is one to look something up in.
  {
    category_name: "Zu erledigen",
    sub_options: [
      {
        id: "action_required",
        label: "Handlungsbedarf",
        iconName: "ExclamationShape",
        hint: {
          // No list of the categories: the page's own hint reads the active tab's
          // `ACTION_REQUIRED_LABELS` entry, and a second telling here would go stale against it.
          lead: "Jedes Spiel der Saison, das eine Eingabe braucht, sortiert nach dem, was es aufhält.",
          note: "Ein abgebrochenes Spiel wartet weiter auf sein Ergebnis.",
        },
      },
      {
        id: "bewerbungen",
        label: "Bewerbungen",
        iconName: "Tray",
        hint: {
          lead: "Alle Bewerbungen von Schulen, die in eine Saison wollen.",
          points: [{ term: "Eine Zusage", detail: "legt das Team an und nimmt es in die Saison auf." }],
          // What an admin comes here to do and cannot: neither decision has a control that takes it back.
          note: "Über eine Bewerbung wird einmal entschieden.",
        },
      },
    ],
  },

  // Structure first, lookup last — not alphabetical: the Spieltage and the Finalrunden are what a
  // season is built from, and the Spielsuche is how one fixture in it is found.
  {
    category_name: "Spielbetrieb",
    sub_options: [
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
        hint: {
          lead: "Die Finalrunden der Saison.",
        },
      },
      {
        id: "spielsuche",
        label: "Spielsuche",
        iconName: "Magnifier",
        hint: {
          lead: "Alle Spiele der Saison.",
          points: [
            // Herkunft is searched as the label a reader sees — „Sieger von Spiel 25“ finds the
            // fixture fed by match 25, which no other term here would.
            { term: "Gesucht werden kann nach", detail: "Team, Herkunft, Ort, Datum, Spielnummer und Schiedsrichter." },
          ],
        },
      },
    ],
  },

  {
    category_name: "Vereine",
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
        id: "kontakte",
        label: "Kontakte",
        iconName: "Envelope",
        hint: {
          // What the list is scoped to, which the rows alone cannot say: the same school is reached
          // through different people from one season to the next.
          lead: "Wer für die Teams der gewählten Saison erreichbar ist.",
          // True of every seat on every row, so it is said here rather than on one of them.
          points: [{ term: "Diese Kontaktdaten", detail: "bleiben in der Verwaltung und erscheinen nirgends öffentlich." }],
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
    ],
  },

  // What gets booked ONTO a fixture rather than belonging to a club, which is why a referee sits
  // beside a pitch and not beside a player.
  {
    category_name: "Ansetzung",
    sub_options: [
      {
        id: "schiedsrichter",
        label: "Schiedsrichter",
        iconName: "Person",
        hint: {
          lead: "Alle Schiedsrichter, mit Kontakt und Honorar.",
        },
      },
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

  // Its own group rather than a row under „Ansetzung“ or „Protokoll“: neither a fixture nor a record
  // of what an administrator did, and a group of one is what keeps the other two answering for
  // themselves.
  {
    category_name: "Zugang",
    sub_options: [
      {
        id: "sperrliste",
        label: "Sperrliste",
        iconName: "Ban",
        hint: {
          lead: "Adressen, die von der Liga gesperrt wurden.",
          // What a reader would otherwise hunt the list for: the search bar reaches the reason and
          // the administrator, and a stored ban holds no address to match against.
          points: [{ term: "Die Adresse selbst", detail: "steht in keiner Zeile und lässt sich hier nicht suchen." }],
          // What an admin comes here to do and cannot: no row expires, and none ever will.
          note: "Eine Sperre bleibt, bis sie hier aufgehoben wird.",
        },
      },
    ],
  },

  {
    category_name: "Protokoll",
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
