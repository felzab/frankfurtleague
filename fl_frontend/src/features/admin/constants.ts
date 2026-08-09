/**
 * ADMIN · navigation structure
 *
 * The admin sidemenu, and the icon dictionary it is validated against. Kept in one file precisely so
 * the two cannot disagree.
 */

import { Calendar, ExclamationShape, Magnifier, MapPin, Medal, Person, PersonPencil, Persons, Sliders } from "@gravity-ui/icons";

import type { SidemenuStructure } from "@/shared/types/types";
import type React from "react";

/**
 * The icon dictionary lives beside the structure it must agree with, and `AdminIconName` is derived
 * from it — so an `iconName` typo below is a compile error instead of a nav item that silently
 * renders without an icon.
 */
export const ADMIN_SIDEMENU_ICONS = {
  ExclamationShape,
  Magnifier,
  Medal,
  Person,
  // The player list's own glyph: a person with a pencil, distinct from Schiedsrichter's bare Person
  // and from Teams' Persons, so the three entries under Beteiligte are told apart at a glance.
  PersonPencil,
  Persons,
  MapPin,
  // The season's own glyph. Not a calendar, which is the Spieltage entry's below and the public
  // Spielplan's: what that page edits is the competition's settings — the points, the groups, the
  // levels — and the rollover, so a set of controls reads truer than a date range would.
  Sliders,
  // The matchday list's, and the public Spielplan's own (`DASHBOARD_SIDEMENU_ICONS`): the same
  // matchdays seen for a different purpose, which the Finalrunden and Teams entries treat the same way.
  Calendar,
} as const satisfies Record<string, React.ElementType>;

export type AdminIconName = keyof typeof ADMIN_SIDEMENU_ICONS;

export const ADMIN_SIDEMENU_STRUCTURE: SidemenuStructure<AdminIconName> = [
  // First, and DELIBERATELY UNNAMED (decided 2026-08-07). Everything below it is scoped by a season --
  // the selector at the top of this menu, the group a team holds, the squad a player is in, the matches
  // a Spieltag groups -- so the season sits above them all, and a heading here would be naming the thing
  // the whole menu is already about. `SidemenuNavLinks` renders no label for an empty name.
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
            { term: "Bearbeiten", detail: "der Stift öffnet die Saisonseite mit Zeitraum, Regeln und Umstellung." },
            { term: "Umstellen", detail: "macht eine geplante Saison zur laufenden und schließt die bisherige ab." },
            { term: "Punkte", detail: "gelten rückwirkend, weil die Tabelle bei jedem Aufruf neu gerechnet wird." },
          ],
          note: "Eine Saison wird nie gelöscht. Eine gespielte Saison ist abgeschlossen und bleibt abrufbar.",
        },
      },
    ],
  },

  {
    category_name: "Spiele",
    // The order is the order the four are REACHED IN (decided 2026-08-08): what needs doing, then finding
    // one fixture, then the schedule those fixtures sit in, then the draw that decides the later ones. The
    // queue leads because it is the only entry that answers "is there anything to do at all" — the other
    // three are all "take me to a thing I already have in mind".
    sub_options: [
      // "Handlungsbedarf", not "Übersicht": the page is a queue of the things needing an admin, ranked
      // by what each one blocks (ADR-0056) — an overview is what `spielsuche` below is. The label is
      // also the collapsed sidemenu's tooltip and the page's own title in the bar, so all three move
      // together.
      {
        id: "action_required",
        label: "Handlungsbedarf",
        iconName: "ExclamationShape",
        hint: {
          lead: "Jedes Spiel, das gerade eine Eingabe braucht, sortiert nach dem, was es aufhält.",
          points: [
            { term: "Verweise und Besetzung", detail: "ohne diese Angaben löst sich kein späteres KO-Spiel auf." },
            { term: "Ergebnis", detail: "Tabelle und Setzung warten darauf." },
            { term: "Datum, Uhrzeit, Ort, Schiedsrichter", detail: "Pflege, die nichts weiter aufhält." },
          ],
          note: "Abgesagte Spiele stehen nur zum Nachschlagen dort, sie sind keine Aufgabe.",
        },
      },
      {
        id: "spielsuche",
        label: "Spielsuche",
        iconName: "Magnifier",
        hint: {
          lead: "Durchsucht alle Spiele der Saison, um eines gezielt zu öffnen.",
          points: [
            { term: "Gesucht wird in", detail: "Mannschaft, Ort, Datum, Spielnummer und Schiedsrichter." },
            { term: "Bearbeiten", detail: "der Stift auf einer Karte öffnet das Spiel." },
          ],
        },
      },
      // The two structural surfaces come after the two that reach a single fixture: a Spieltag is the block
      // matches belong to, and the Finalrunden are how the later ones are wired — both are read to check the
      // shape of the season rather than to act on one match.
      {
        id: "spieltage",
        label: "Spieltage",
        iconName: "Calendar",
        hint: {
          lead: "Die Spieltage der im Seitenmenü gewählten Saison, nach Phase und in der Reihenfolge, in der sie gespielt werden.",
          points: [
            { term: "Name und Position", detail: "ergeben sich aus Phase und Beginn. Um einen Spieltag zu verschieben, ändere sein Datum." },
            { term: "Spiele", detail: "die angelegte Zahl neben der erwarteten. Weichen sie ab, fehlt etwas." },
            { term: "Stilllegen", detail: "nimmt den Spieltag aus den Listen. Nur möglich, solange keines seiner Spiele ein Ergebnis hat." },
          ],
          note: "Sobald die KO.-Runde begonnen hat, lassen sich keine Spieltage mehr anlegen.",
        },
      },
      // Named AND iconed for the public bracket's own entry (`DASHBOARD_SIDEMENU_ICONS`), because it is the
      // same rounds seen for a different purpose — a second word and a second glyph for one stage are two
      // more things to learn for nothing.
      {
        id: "finalrunden",
        label: "Finalrunden",
        iconName: "Medal",
        // The chip legend lives here rather than on the page, so the surface has ONE info glyph and
        // it is the shell's — a second one beside the title would be two answers to one question.
        hint: {
          lead: "Woher jede Seite jedes KO-Spiels kommt und wer gerade darin steht. Zum Prüfen der Auslosung, bevor sie gespielt wird.",
          points: [
            { term: "„1. der Gruppe A“", detail: "aus der Tabelle gesetzt. So wird die erste KO.-Runde besetzt." },
            { term: "„Sieger 25.“", detail: "aus einem früheren Spiel. So wird jede spätere Runde besetzt." },
            { term: "„Manuell gesetzt“", detail: "diese Seite gehört Dir, keine Auflösung schreibt hinein." },
            { term: "„Ohne Herkunft“", detail: "weder Mannschaft noch Herkunft. Diese Seite füllt niemand." },
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
      // Named AND iconed for the public team list's own entry (`DASHBOARD_SIDEMENU_ICONS`), for the
      // finalrunden entry's reason: the same clubs seen for a different purpose.
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
              term: "Stilllegen",
              detail: "nur möglich, solange das Team in keiner laufenden oder geplanten Saison spielt. Sein Kürzel bleibt reserviert.",
            },
          ],
          note: "Eine Disqualifikation gilt für eine Saison und wird auf der Teamseite eingetragen. Aus einer Saison entfernt wird nie.",
        },
      },
      // Directly below Teams, which is the order the two are reached in: a player is entered into a
      // team's squad, so the team has to exist first.
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
          ],
          note: "Eine stillgelegte Person bleibt in jedem Spiel stehen, das sie schon nennt.",
        },
      },
    ],
  },
];
