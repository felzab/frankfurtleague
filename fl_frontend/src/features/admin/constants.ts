import At from "@gravity-ui/icons/At";
import Ban from "@gravity-ui/icons/Ban";
import Calendar from "@gravity-ui/icons/Calendar";
import ClockArrowRotateLeft from "@gravity-ui/icons/ClockArrowRotateLeft";
import Envelope from "@gravity-ui/icons/Envelope";
import ExclamationShape from "@gravity-ui/icons/ExclamationShape";
import Hourglass from "@gravity-ui/icons/Hourglass";
import Key from "@gravity-ui/icons/Key";
import Magnifier from "@gravity-ui/icons/Magnifier";
import MapPin from "@gravity-ui/icons/MapPin";
import Medal from "@gravity-ui/icons/Medal";
import Person from "@gravity-ui/icons/Person";
import PersonPencil from "@gravity-ui/icons/PersonPencil";
import Persons from "@gravity-ui/icons/Persons";
import PersonXmark from "@gravity-ui/icons/PersonXmark";
import Sliders from "@gravity-ui/icons/Sliders";
import Tray from "@gravity-ui/icons/Tray";

import { ADMINISTRATOREN_TITEL, VERWALTUNG_TITEL } from "@/core/seitenNamen";

import type { SidemenuHint, SidemenuStructure, SidemenuStructureSubOption } from "@/shared/types/types";
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
  // Registrations waiting on their team, never the in-tray: nothing on that page is the administrator's to work down.
  Hourglass,
  // The season's glyph, never a calendar — that is the Spieltage entry's below.
  Sliders,
  Calendar,
  ClockArrowRotateLeft,
  Ban,
  // Access to the administration itself, beside the ban list's refusal of it.
  Key,
  // A person taken out of the league whole, never the bin a single record's removal wears.
  PersonXmark,
  // An address, never the envelope the contacts list wears: what moves is the sign-in, not a message.
  At,
} as const satisfies Record<string, React.ElementType>;

export type AdminIconName = keyof typeof ADMIN_SIDEMENU_ICONS;

/**
 * What the bar reads on an address that belongs to no section, the catch-all's 404 among them. The area's name, never a
 * section's: a heading naming one describes a page the reader is not on (WCAG 2.4.6).
 */
export const ADMIN_SHELL_FALLBACK = {
  label: VERWALTUNG_TITEL,
  hint: {
    lead: `Diese Adresse gehört zu keiner Seite unter „${VERWALTUNG_TITEL}“.`,
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

/** The page of fixtures waiting on an entry, named where the erasure sends a reader to it, so a rename reaches both. */
export const HANDLUNGSBEDARF_EINTRAG = {
  id: "action_required",
  label: "Handlungsbedarf",
  iconName: "ExclamationShape",
  hint: {
    // No list of the categories: the page's own hint reads the active tab's
    // `ACTION_REQUIRED_LABELS` entry, and a second telling here would go stale against it.
    lead: "Jedes Spiel der Saison, das eine Eingabe braucht, sortiert nach dem, was es aufhält.",
    note: "Ein abgebrochenes Spiel wartet weiter auf sein Ergebnis.",
  },
} as const satisfies SidemenuStructureSubOption<AdminIconName>;

/** The season list's entry, named where a taken season id sends a reader to the existing season, so a rename reaches both. */
export const SAISONS_EINTRAG = {
  id: "saisons",
  label: "Saisons",
  iconName: "Sliders",
  hint: {
    lead: "Alle Saisons, mit Zeitraum und Regeln.",
    // What an admin comes here to do and cannot: no row carries a delete control, and none ever will.
    note: "Eine Saison wird nie gelöscht.",
  },
} as const satisfies SidemenuStructureSubOption<AdminIconName>;

/** The season's matchdays, named where the season editor sends a reader to date them, so a rename reaches both. */
export const SPIELTAGE_EINTRAG = {
  id: "spieltage",
  label: "Spieltage",
  iconName: "Calendar",
  hint: {
    lead: "Die Spieltage der Saison.",
    // What an admin comes here to do and cannot: this list has no create control, and the
    // draw that makes a Spieltag is on the season page.
    note: "Spieltage entstehen zusammen mit dem Spielplan.",
  },
} as const satisfies SidemenuStructureSubOption<AdminIconName>;

/** The knockout rounds' entry, named where the season list says what an empty league leaves blank, so a rename reaches both. */
export const FINALRUNDEN_EINTRAG = {
  id: "finalrunden",
  label: "Finalrunden",
  iconName: "Medal",
  hint: {
    lead: "Die Finalrunden der Saison.",
  },
} as const satisfies SidemenuStructureSubOption<AdminIconName>;

/** The fixture search's entry, named where the season list says what an empty league leaves blank, so a rename reaches both. */
export const SPIELSUCHE_EINTRAG = {
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
} as const satisfies SidemenuStructureSubOption<AdminIconName>;

/** The club list's entry, named where an application's refusal sends a reader to it, so a rename reaches both. */
export const TEAMS_EINTRAG = {
  id: "teams",
  label: "Teams",
  iconName: "Persons",
  hint: {
    // The appositive rather than the columns: the list spans every season, while what each row
    // shows beside the name is the selected season's.
    lead: "Alle Teams über alle Saisons, mit den Angaben der gewählten Saison.",
  },
} as const satisfies SidemenuStructureSubOption<AdminIconName>;

/** The ban list's entry, named where a refused address sends a reader to lift its ban, so a rename reaches both. */
export const SPERRLISTE_EINTRAG = {
  id: "sperrliste",
  label: "Sperrliste",
  iconName: "Ban",
  hint: {
    lead: "Adressen, die von der Liga gesperrt wurden.",
    // What a reader would otherwise hunt the list for: the search bar reaches the reason and
    // the administrator, and a stored ban holds no address to match against.
    points: [{ term: "Die Adresse selbst", detail: "steht in keiner Zeile und lässt sich hier nicht suchen." }],
    // Both ways a row goes, since an admin reading the list takes a missing ban for a lifted one.
    note: "Eine Sperre endet nach fünf vollen Saisons von selbst, oder wenn sie hier aufgehoben wird.",
  },
} as const satisfies SidemenuStructureSubOption<AdminIconName>;

/** The erasure page's sign-out panel and its press, named by the page's hint: one spelling, so a renamed panel takes the hint with it. */
export const UEBERALL_ABMELDEN = "Überall abmelden";

/** The erasure page's entry, named where another page sends a reader to it, so a rename reaches both. */
export const LOESCHUNG_EINTRAG = {
  id: "loeschung",
  label: "Löschung auf Anfrage",
  iconName: "PersonXmark",
  hint: {
    lead: "Alle Daten einer Person löschen, die per E-Mail darum gebeten hat.",
    points: [
      { term: "Die Adresse", detail: "gibst Du zweimal ein, zum Anzeigen und zum Bestätigen." },
      // The page's second panel, which its label does not name: an admin opening the menu for a sign-out finds it here.
      { term: `„${UEBERALL_ABMELDEN}“`, detail: "beendet jede Anmeldung einer Adresse, ohne ihre Daten zu löschen." },
    ],
    // What an admin comes here to do and cannot: no control on this page takes an erasure back.
    note: "Eine Löschung lässt sich nicht zurücknehmen.",
  },
} as const satisfies SidemenuStructureSubOption<AdminIconName>;

/** The address tool's entry, named where an editor and a refusal send a reader to it, so a rename reaches both. */
export const ADRESSWECHSEL_EINTRAG = {
  id: "adresswechsel",
  label: "Adressänderung auf Anfrage",
  iconName: "At",
  hint: {
    lead: "Die E-Mail-Adresse einer Person ändern, die sich nicht mehr anmelden kann.",
    points: [
      { term: "Wer sich anmelden kann", detail: "ändert die eigene Adresse selbst auf der Kontoseite." },
      // Keyed by the address a person writes from, as the erasure's page is: nothing here is browsed.
      { term: "Die bisherige Adresse", detail: "gibst Du ein, um zu sehen, was unter ihr steht." },
    ],
  },
} as const satisfies SidemenuStructureSubOption<AdminIconName>;

export const ADMIN_SIDEMENU_STRUCTURE: SidemenuStructure<AdminIconName> = [
  // Deliberately unnamed: a season is created and edited here, which makes this the subject the menu
  // is organised under rather than one more group in it. `SidemenuNavLinks` renders neither a label
  // nor a rule for an empty name.
  {
    category_name: "",
    sub_options: [SAISONS_EINTRAG],
  },

  // Grouped by what an admin DOES here: both are queues worked down to nothing, where every list
  // below is one to look something up in.
  {
    category_name: "Zu erledigen",
    sub_options: [
      HANDLUNGSBEDARF_EINTRAG,
      {
        id: "bewerbungen",
        label: "Bewerbungen",
        iconName: "Tray",
        hint: {
          lead: "Alle Bewerbungen von Schulen, die in eine Saison wollen.",
          points: [{ term: "Eine Zusage", detail: "nimmt das Team in die Saison auf und legt es an, wenn die Schule neu ist." }],
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
    sub_options: [SPIELTAGE_EINTRAG, FINALRUNDEN_EINTRAG, SPIELSUCHE_EINTRAG],
  },

  {
    category_name: "Vereine",
    sub_options: [
      TEAMS_EINTRAG,
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
        id: "registrierungen",
        label: "Registrierungen",
        iconName: "Hourglass",
        hint: {
          lead: "Wer sich bei einem Team registriert hat und noch nicht aufgenommen ist, über alle Saisons.",
          // What an admin comes here to do and cannot: the decision has no control on this page.
          note: "Über eine Registrierung entscheidet das Team.",
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

  // Its own group rather than rows under „Ansetzung“ or „Protokoll“: who may enter is neither a fixture
  // nor a record of what an administrator did, and a group of its own keeps the other two answering
  // for themselves.
  {
    category_name: "Zugang",
    sub_options: [
      SPERRLISTE_EINTRAG,
      {
        id: "administratoren",
        label: ADMINISTRATOREN_TITEL,
        iconName: "Key",
        hint: {
          lead: "Wer die Verwaltung der Liga betreten darf.",
          // What every change costs, a change made in the database directly included.
          note: "Jede Änderung geht per Mail an alle mit Zugang.",
        },
      },
    ],
  },

  // Its own group rather than a row under „Protokoll“, which records what an administrator did: an erasure and an address change are
  // things done, each answering a person's request.
  {
    category_name: "Datenschutz",
    sub_options: [LOESCHUNG_EINTRAG, ADRESSWECHSEL_EINTRAG],
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
