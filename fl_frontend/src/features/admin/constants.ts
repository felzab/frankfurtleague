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

import type { SidemenuStructure } from "@/shared/types/types";
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
          lead: "Alle Saisons, ihre Zeiträume und die Regeln, nach denen sie gespielt werden.",
          points: [
            { term: "Anlegen", detail: "über die Schaltfläche oben rechts. Eine neue Saison ist immer geplant, nie laufend." },
            {
              term: "Bearbeiten",
              // The panels' own headings, in render order: this is a wayfinding list, and an admin
              // scans the page for the word it names.
              detail:
                "der Stift öffnet die Saisonseite mit Zeitraum, Regeln, Gruppentausch, Team ersetzen, Spielplan, " +
                "Spielplan zurücknehmen und Umstellung.",
            },
            { term: "Umstellen", detail: "macht eine geplante Saison zur laufenden Saison und schließt die bisherige ab." },
            { term: "Punkte", detail: "gelten rückwirkend, auch für längst gespielte Spiele." },
          ],
          note: "Eine Saison wird nie gelöscht. Eine gespielte Saison ist abgeschlossen und bleibt abrufbar.",
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
          lead: "Jedes Spiel, das gerade eine Eingabe braucht, sortiert nach dem, was es aufhält.",
          points: [
            { term: "Fehler und Besetzung", detail: "die dringendsten Fälle; ohne Besetzung löst sich kein späteres KO-Spiel auf." },
            { term: "Ergebnis", detail: "Tabelle und Setzung warten darauf." },
            { term: "Datum, Uhrzeit, Ort, Schiedsrichter", detail: "Pflege, die nichts weiter aufhält." },
          ],
          note: "Ausgefallene, annullierte und nicht angetretene Spiele stehen nur zum Nachschlagen dort. Ein abgebrochenes Spiel wartet weiter auf sein Ergebnis.",
        },
      },
      {
        id: "spielsuche",
        label: "Spielsuche",
        iconName: "Magnifier",
        hint: {
          lead: "Durchsucht alle Spiele der Saison, um eines gezielt zu öffnen.",
          points: [
            // Herkunft is searched as the label a reader sees — „Sieger 25.“ finds the fixture fed
            // by match 25, which no other term here would.
            { term: "Gesucht wird in", detail: "Team, Herkunft, Ort, Datum, Spielnummer und Schiedsrichter." },
            { term: "Bearbeiten", detail: "der Stift auf einer Karte öffnet das Spiel." },
          ],
        },
      },
      {
        id: "spieltage",
        label: "Spieltage",
        iconName: "Calendar",
        hint: {
          lead: "Die Spieltage der im Seitenmenü gewählten Saison, nach Phase und in der Reihenfolge, in der sie gespielt werden.",
          points: [
            { term: "Name", detail: "folgt aus der Runde, zu der ein Spieltag gehört." },
            { term: "Zeitraum", detail: "der Stift öffnet den Spieltag, dort trägst Du Beginn und Ende ein." },
            { term: "Spiele", detail: "die angelegte Zahl neben der erwarteten. Weichen sie ab, fehlt etwas." },
          ],
          note: "Die Spieltage einer Saison entstehen zusammen mit ihrem Spielplan. Hier legst Du ihren Zeitraum fest.",
        },
      },
      {
        id: "finalrunden",
        label: "Finalrunden",
        iconName: "Medal",
        // The chip legend lives in the shell's hint and not on the page, so the surface has one info
        // glyph rather than two answers to one question.
        hint: {
          lead: "Woher jede Seite jedes KO-Spiels kommt und wer gerade darin steht. Zum Prüfen der Auslosung, bevor sie gespielt wird.",
          points: [
            { term: "„1. der Gruppe A“", detail: "aus der Tabelle gesetzt. So wird die erste KO-Runde besetzt." },
            { term: "„Sieger 25.“", detail: "aus einem früheren Spiel. So wird jede spätere Runde besetzt." },
            { term: "„Manuell gesetzt“", detail: "diese Seite gehört Dir, keine Auflösung schreibt hinein." },
            { term: "„Ohne Herkunft“", detail: "weder Team noch Herkunft. Diese Seite füllt niemand." },
          ],
          note: "Die Gruppenphase steht nicht dort: ihre Paarungen kommen aus dem Spielplan und haben keine Herkunft.",
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
          lead: "Alle Austragungsorte, mit Adresse und Mietpreis.",
          points: [
            { term: "Anlegen", detail: "über die Schaltfläche oben rechts." },
            { term: "Stilllegen", detail: "nimmt den Ort aus den Auswahllisten, ohne ihn zu löschen." },
          ],
          note: "Ein stillgelegter Ort bleibt in jedem Spiel stehen, das ihn schon nennt.",
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
          lead: "Alle Teams über alle Saisons, mit Gruppe und Status der im Seitenmenü gewählten Saison.",
          points: [
            { term: "Anlegen", detail: "über die Schaltfläche oben rechts. Das Team wird dabei direkt in eine Saison aufgenommen." },
            { term: "Bearbeiten", detail: "der Stift öffnet die Teamseite mit Stammdaten und Saison-Zugehörigkeit." },
            {
              term: "Ersetzen",
              detail:
                "gibt den Platz eines Teams in einer Saison an ein anderes ab, mitsamt seiner angesetzten Spiele. " +
                "Auf der Saisonseite unter „Team ersetzen“, nicht hier.",
            },
            {
              term: "Stilllegen",
              detail: "nur möglich, solange das Team in keiner laufenden oder geplanten Saison spielt. Sein Kürzel bleibt reserviert.",
            },
          ],
          // The two routes out of a season, told apart by what happens to the fixtures — an admin
          // who reads them as interchangeable picks the one that leaves them on the departed team.
          note: "Ein Austritt gilt für eine Saison und wird auf der Teamseite eingetragen, als Disqualifikation oder als Rückzug. Seine Spiele bleiben dabei bei ihm stehen; beim Ersetzen wechseln sie mit.",
        },
      },
      {
        id: "spieler",
        label: "Spieler",
        iconName: "PersonPencil",
        hint: {
          lead: "Alle Spieler über alle Saisons, mit Team, Nummer und Status der im Seitenmenü gewählten Saison.",
          points: [
            { term: "Anlegen", detail: "über die Schaltfläche oben rechts. Der Spieler wird dabei direkt in einen Kader aufgenommen." },
            { term: "Bearbeiten", detail: "der Stift öffnet die Spielerseite mit Person und Kadereintrag." },
            { term: "Teamwechsel", detail: "wird auf der Spielerseite eingetragen. Der Spieler bleibt dieselbe Person." },
            {
              term: "Stilllegen",
              detail: "nimmt die Person aus den Auswahllisten. Ihre Kadereinträge bleiben in jeder gespielten Saison erhalten.",
            },
            {
              term: "Löschen",
              detail:
                "entfernt eine stillgelegte Person endgültig — mit allen Kadereinträgen und ihren Angaben im Änderungsprotokoll. " +
                "Zurückholen lässt sich das nicht.",
            },
          ],
          note: "Ein Kadereintrag wird getrennt davon ausgetragen und behält dabei Nummer, Position und Stufe.",
        },
      },
      {
        id: "schiedsrichter",
        label: "Schiedsrichter",
        iconName: "Person",
        hint: {
          lead: "Alle Schiedsrichter, mit Kontaktdaten und Entschädigung.",
          points: [
            { term: "Anlegen", detail: "über die Schaltfläche oben rechts." },
            { term: "Stilllegen", detail: "nimmt die Person aus den Auswahllisten, ohne sie zu löschen." },
            {
              term: "Kontaktdaten löschen",
              detail:
                "entfernt E-Mail und Telefonnummer endgültig, auch aus dem Änderungsprotokoll. " +
                "Der Schiedsrichter selbst bleibt mit seinem Namen bestehen, weil jedes Spiel ihn nennt.",
            },
          ],
          note: "Eine stillgelegte Person bleibt in jedem Spiel stehen, das sie schon nennt.",
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
          lead: "Jede Änderung, die über die Verwaltung geschrieben wurde, neueste zuerst.",
          points: [
            { term: "Wer", detail: "die angemeldete Person. „System“ steht für einen Lauf ohne Anmeldung, etwa eine Wartung." },
            {
              term: "Art",
              detail:
                "was geschehen ist. Eine Sammeländerung trifft alle Datensätze eines Filters auf einmal. „Mehrere angelegt“ benennt keinen einzelnen Datensatz, sondern nur die Zahl. „Gelöscht, ohne Stand“ heißt, dass zu dieser Zeile bewusst kein früherer Datensatz aufbewahrt wurde — so werden die Angaben einer Person entfernt.",
            },
            { term: "Stand gesichert", detail: "der Datensatz von vor der Änderung liegt in dieser Zeile." },
            { term: "Vorgangsnummer", detail: "kopiere sie und suche danach, um jede Zeile eines einzelnen Speicherns zu sehen." },
          ],
          note: "Das Protokoll ist zum Nachschlagen da. Von hier aus lässt sich nichts zurücknehmen.",
        },
      },
    ],
  },
];
