import { SONDEREREIGNIS_LABELS } from "@/features/spiele/constants";
import { kaderName, NUMMER_NICHT_HINTERLEGT, SPIELER_ANONYM_LABEL } from "@/features/spieler/constants";
import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";

import { SPIELBERICHT_ZUSTAENDE_OFFEN } from "./constants";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSpielberichtSpieler, FLSpielberichtVorschlag, FLSpielberichtZustandEintrag } from "./schemas";

/** The proposal as one line: the score, its shoot-out, and the event, a no-show naming its event alone. */
export function vorschlagText(vorschlag: FLSpielberichtVorschlag): string {
  const ereignis = vorschlag.sonderereignis === null ? null : SONDEREREIGNIS_LABELS[vorschlag.sonderereignis];
  if (vorschlag.team1_tore === null || vorschlag.team2_tore === null) return ereignis ?? "";

  const elfmeter =
    vorschlag.elfmeterschiessen === null
      ? ""
      : ` (${String(vorschlag.elfmeterschiessen.team1)}:${String(vorschlag.elfmeterschiessen.team2)} i. E.)`;
  return `${String(vorschlag.team1_tore)}:${String(vorschlag.team2_tore)}${elfmeter}${ereignis === null ? "" : `, ${ereignis}`}`;
}

/**
 * What an administrator's fixture card says of its report, `null` for a state awaiting nobody: the two states the
 * triage files under „Ergebnis vorgeschlagen“, each in its own words.
 */
export function berichtChipText({ zustand, ergebnis_vorschlag }: FLSpielberichtZustandEintrag): string | null {
  if (!SPIELBERICHT_ZUSTAENDE_OFFEN.has(zustand)) return null;

  return `${zustand === "vorgeschlagen" ? "Ergebnis vorgeschlagen" : "Bericht geändert"} ${vorschlagText(ergebnis_vorschlag)}`;
}

/** A pupil as a report's reader sees them: shirt number and name, and the erased pupils' sentinel as „anonym“. */
export function spielerLabel(spieler: FLSpielberichtSpieler): string {
  if (spieler.vorname === null) return SPIELER_ANONYM_LABEL;

  return `${spieler.nummer ?? NUMMER_NICHT_HINTERLEGT} · ${kaderName({ vorname: spieler.vorname, nachname: spieler.nachname })}`;
}

// Europe/Berlin, as every other date in this app is rendered, and to the minute: a correction made the same day as
// the adoption is exactly what the administrator needs to tell apart.
const BERLIN_ZEITPUNKT = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** A stored instant as the administrator reads it; one no date can parse is shown as stored rather than thrown on. */
export function berlinZeitpunkt(stamp: string): string {
  const instant = new Date(stamp);
  return Number.isNaN(instant.getTime()) ? stamp : `${BERLIN_ZEITPUNKT.format(instant)} Uhr`;
}

/** Who reads the sentence: the booked referee on their panel, or an administrator correcting the report. */
export type SpielberichtLeser = "schiedsrichter" | "admin";

/** The remarks' name refusal lands on the box, the one control that can repair it. */
export const BEMERKUNGEN_PATH = "bericht.bemerkungen";

// The box's hint already asks for a shirt number, so the message names the fault alone (`docs/frontend/spec.md` §1.12).
const NAME_IN_BEMERKUNGEN = "In den Bemerkungen steht ein Name.";

// The reload draws the form anew from the report standing now, so the change the press carried has to be entered again.
const NEU_EINTRAGEN = "Lade die Seite neu und trage Deine Änderung dort erneut ein";

const SAETZE: Record<SpielberichtLeser, Readonly<Record<string, string>>> = {
  schiedsrichter: {
    // Ahead of the spine's own reading, whose sentence names a team: the referee's record is what went.
    "REQ-FUNKTION-001": "Du bist nicht mehr als Schiedsrichter eingetragen. Lade die Seite neu.",
    "REQ-BERICHT-001": buildRefusal({ reason: "Dieses Spiel hat noch kein Datum oder noch nicht stattgefunden", repair: LADE_DIE_SEITE_NEU }),
    "REQ-BERICHT-002": buildRefusal({ reason: "Dieses Spiel leitest Du nicht mehr", repair: LADE_DIE_SEITE_NEU }),
    "REQ-BERICHT-003": buildRefusal({
      reason: "Eine gewählte Person steht nicht mehr im Kader ihres Teams",
      repair: "Lade die Seite neu und wähle neu",
    }),
    "REQ-BERICHT-004": "Dieses Spiel ist ausgefallen oder annulliert. Dafür gibt es keinen Spielbericht.",
    "REQ-BERICHT-006": buildRefusal({
      reason: "Der Spielbericht wurde inzwischen geändert, etwa von der Verwaltung oder von Dir in einem anderen Fenster",
      repair: NEU_EINTRAGEN,
    }),
    "DB-COMMON-002": buildRefusal({ reason: "Der Spielbericht wurde gerade gleichzeitig gespeichert", repair: LADE_DIE_SEITE_NEU }),
  },
  admin: {
    "REQ-BERICHT-001": buildRefusal({ reason: "Das Spiel hat noch kein Datum oder liegt in der Zukunft", repair: "Trag zuerst das Datum ein" }),
    "REQ-BERICHT-003": buildRefusal({
      reason: "Eine gewählte Person steht nicht im Kader ihres Teams",
      repair: "Lade die Seite neu und wähle neu",
    }),
    "REQ-BERICHT-004": "Das Spiel ist als ausgefallen oder annulliert eingetragen. Dafür gibt es keinen Spielbericht.",
    "REQ-BERICHT-006": buildRefusal({
      reason: "Der Spielbericht wurde inzwischen geändert, etwa von der Schiedsrichterin oder dem Schiedsrichter",
      repair: NEU_EINTRAGEN,
    }),
    "DB-COMMON-002": buildRefusal({ reason: "Der Spielbericht wurde gerade gleichzeitig gespeichert", repair: LADE_DIE_SEITE_NEU }),
  },
};

/** A report write's refusal in its reader's words, `null` for a code neither write answers. */
export function mapSpielberichtRefusal(error: unknown, leser: SpielberichtLeser): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error) || error.serverErrorCode === undefined) return null;

  if (error.serverErrorCode === "REQ-BERICHT-005") return { fieldErrors: { [BEMERKUNGEN_PATH]: NAME_IN_BEMERKUNGEN } };

  const saetze = SAETZE[leser];
  // Own keys alone, so a code spelling an inherited member never reads as worded.
  return Object.hasOwn(saetze, error.serverErrorCode) ? { error: saetze[error.serverErrorCode] } : null;
}
