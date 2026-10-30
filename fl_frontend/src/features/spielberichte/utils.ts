import { ZEITZONE } from "@/core/format";
import { kaderName, NUMMER_NICHT_HINTERLEGT, SPIELER_ANONYM_LABEL } from "@/features/spieler/constants";
import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";

import { SPIELBERICHT_ZUSTAENDE_OFFEN, SPIELBERICHT_ZUSTAND_TONE } from "./constants";

import type { PillTone } from "@/shared/components/ui/badges";
import type { FieldErrors } from "@/shared/utils/validation";
import type {
  FLSpielberichtSeiten,
  FLSpielberichtSpiel,
  FLSpielberichtSpieler,
  FLSpielberichtVorschlag,
  FLSpielberichtZustandEintrag,
} from "./schemas";
import type { Eingesetzt } from "./types";

/**
 * A fixture card's word on its report, worn in its state's tone, and the proposal the card renders after it through
 * `fl_frontend/src/features/spielberichte/components/ui/VorschlagText.tsx`; `null` where the card names no score.
 */
export type BerichtChip = { readonly worte: string; readonly vorschlag: FLSpielberichtVorschlag | null; readonly tone: PillTone };

/**
 * What an administrator's fixture card says of its report, in its state's tone; `null` for a state awaiting nobody.
 * `abweichend` reads „nicht übernommen“, never „geändert“: a first report beside a hand-typed result reads it too.
 */
export function berichtChip({ zustand, ergebnis_vorschlag }: FLSpielberichtZustandEintrag): BerichtChip | null {
  if (!SPIELBERICHT_ZUSTAENDE_OFFEN.has(zustand)) return null;
  // No score: it was proposed for other clubs than the fixture fields now, and beside the card it would read as theirs.
  if (zustand === "teams_geaendert") {
    return { worte: "Bericht zu anderen Teams", vorschlag: null, tone: SPIELBERICHT_ZUSTAND_TONE[zustand] };
  }

  const worte = zustand === "vorgeschlagen" ? "Ergebnis vorgeschlagen" : "Bericht nicht übernommen";
  return { worte, vorschlag: ergebnis_vorschlag, tone: SPIELBERICHT_ZUSTAND_TONE[zustand] };
}

/** A side as the match editor's draft holds it: the club, its goals, and nothing where the slot is open. */
type EntwurfSeite = { readonly team_id: string; readonly tore: number | null } | null;

/**
 * Why „Vorschlag übernehmen“ cannot seed the draft, `null` where it can. Against the report's `seiten`, never the
 * fixture's: the goals go by side, and a correction upstream re-fields the fixture and the draft seeded from it alike.
 */
export function uebernahmeGesperrt(seiten: FLSpielberichtSeiten, entwurf: { team1: EntwurfSeite; team2: EntwurfSeite }): string | null {
  if (entwurf.team1 === null || entwurf.team2 === null) return "Im Formular stehen noch nicht beide Teams.";
  if (entwurf.team1.team_id !== seiten.team1 || entwurf.team2.team_id !== seiten.team2) {
    return "Die Teams im Formular sind nicht die des Spielberichts.";
  }

  return null;
}

/** Whether the editor's result atoms still hold the proposal „Vorschlag übernehmen“ seeded them with. */
export function haeltVorschlag(
  vorschlag: FLSpielberichtVorschlag,
  entwurf: {
    team1: EntwurfSeite;
    team2: EntwurfSeite;
    elfmeterschiessen: { readonly team1: number | null; readonly team2: number | null } | null;
    sonderereignis: string | null;
  },
): boolean {
  const { elfmeterschiessen: entwurfElfmeter } = entwurf;
  const elfmeter = vorschlag.elfmeterschiessen;
  const gleicherElfmeter =
    entwurfElfmeter === null || elfmeter === null
      ? entwurfElfmeter === elfmeter
      : entwurfElfmeter.team1 === elfmeter.team1 && entwurfElfmeter.team2 === elfmeter.team2;

  return (
    entwurf.team1?.tore === vorschlag.team1_tore &&
    entwurf.team2?.tore === vorschlag.team2_tore &&
    entwurf.sonderereignis === vorschlag.sonderereignis &&
    gleicherElfmeter
  );
}

/**
 * The seed's standing against the report read now: a refresh after any write on the page can bring a newer report
 * under the mounted editor, whose draft still holds the older proposal and whose save names the older version.
 */
export function eingesetztStand(seedVersion: number | null, berichtVersion: number | null): Eingesetzt {
  if (seedVersion === null) return null;
  return seedVersion === berichtVersion ? "aktuell" : "veraltet";
}

/** A pupil as a report's reader sees them: shirt number and name, and a pupil an erasure took as „anonym“. */
export function spielerLabel(spieler: FLSpielberichtSpieler): string {
  if (spieler.vorname === null) return SPIELER_ANONYM_LABEL;

  return `${spieler.nummer ?? NUMMER_NICHT_HINTERLEGT} · ${kaderName({ vorname: spieler.vorname, nachname: spieler.nachname })}`;
}

// Europe/Berlin, as every other date in this app is rendered, and to the minute: a correction made the same day as
// the adoption is exactly what the administrator needs to tell apart.
const BERLIN_ZEITPUNKT = new Intl.DateTimeFormat("de-DE", {
  timeZone: ZEITZONE,
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

/** Why a fixture takes no report today, `null` where it takes one, as `REQ-BERICHT-001` and `REQ-BERICHT-004` judge a write. */
export type BerichtSperre = "abgesagt" | "undatiert" | "kuenftig";

export function berichtSperre(spiel: Pick<FLSpielberichtSpiel, "datum" | "sonderereignis">, today: string): BerichtSperre | null {
  if (spiel.sonderereignis === "ausgefallen" || spiel.sonderereignis === "annulliert") return "abgesagt";
  if (spiel.datum === null) return "undatiert";
  return spiel.datum > today ? "kuenftig" : null;
}

/** Who reads the sentence: the booked referee on their panel, or an administrator correcting the report. */
export type SpielberichtLeser = "schiedsrichter" | "admin";

export const BEMERKUNGEN_PATH = "bericht.bemerkungen";

// The form offers no shoot-out on a group fixture, so this arrives only from a request no page composed.
const ELFMETER_IN_DER_GRUPPE = buildRefusal({ reason: "Ein Spiel der Gruppenphase hat kein Elfmeterschießen", repair: LADE_DIE_SEITE_NEU });

// The form refuses a caution without its reason before the press, so this arrives only where the stored report moved
// under the page: a reload draws the cards it holds now.
const GRUND_FEHLT = buildRefusal({
  reason: "Bei einer gelben oder gelb-roten Karte fehlt der Grund",
  repair: "Lade die Seite neu und wähle ihn",
});

// The reload draws the form anew from the report standing now, so the change the press carried has to be entered again.
const NEU_EINTRAGEN = "Lade die Seite neu und trage Deine Änderung dort erneut ein";

const SAETZE: Record<SpielberichtLeser, Readonly<Record<string, string>>> = {
  schiedsrichter: {
    // Ahead of the spine's own reading, whose sentence names a team: the referee's record is what went.
    "REQ-FUNKTION-001": "Du bist nicht mehr als Schiedsrichterin oder Schiedsrichter eingetragen. Lade die Seite neu.",
    "REQ-BERICHT-001": buildRefusal({ reason: "Dieses Spiel hat noch kein Datum oder noch nicht stattgefunden", repair: LADE_DIE_SEITE_NEU }),
    "REQ-BERICHT-002": buildRefusal({ reason: "Dieses Spiel leitest Du nicht mehr", repair: LADE_DIE_SEITE_NEU }),
    "REQ-BERICHT-003": buildRefusal({
      reason: "Eine gewählte Person steht nicht mehr im Kader ihres Teams",
      repair: "Lade die Seite neu und wähle neu",
    }),
    "REQ-BERICHT-004": buildRefusal({
      reason: "Dieses Spiel ist inzwischen als ausgefallen oder annulliert eingetragen und nimmt keinen Spielbericht an",
      repair: LADE_DIE_SEITE_NEU,
    }),
    "REQ-BERICHT-008": GRUND_FEHLT,
    "REQ-BERICHT-009": ELFMETER_IN_DER_GRUPPE,
    "REQ-BERICHT-007": buildRefusal({
      reason: "Die Saison dieses Spiels ist vorbei, und den Spielbericht kannst Du nicht mehr ändern",
      repair: LADE_DIE_SEITE_NEU,
    }),
    "REQ-BERICHT-006": buildRefusal({
      reason: "Der Spielbericht wurde inzwischen geändert, etwa von der Verwaltung oder von Dir in einem anderen Fenster",
      repair: NEU_EINTRAGEN,
    }),
    "DB-COMMON-002": buildRefusal({ reason: "Der Spielbericht wurde gerade gleichzeitig gespeichert", repair: NEU_EINTRAGEN }),
  },
  admin: {
    // A reload, no date to enter: the correction page states an undated or future fixture before any press, so this
    // arrives only where the fixture moved under the page, and an entered date may be the future one.
    "REQ-BERICHT-001": buildRefusal({ reason: "Das Spiel hat noch kein Datum oder findet erst noch statt", repair: LADE_DIE_SEITE_NEU }),
    "REQ-BERICHT-003": buildRefusal({
      reason: "Eine gewählte Person steht nicht im Kader ihres Teams",
      repair: "Lade die Seite neu und wähle neu",
    }),
    "REQ-BERICHT-004": buildRefusal({
      reason: "Das Spiel ist als ausgefallen oder annulliert eingetragen",
      repair: "Entferne das Sonderereignis im Spiel, um den Spielbericht zu bearbeiten",
    }),
    "REQ-BERICHT-008": GRUND_FEHLT,
    "REQ-BERICHT-009": ELFMETER_IN_DER_GRUPPE,
    "REQ-BERICHT-006": buildRefusal({
      reason: "Der Spielbericht wurde inzwischen geändert, etwa von der Schiedsrichterin oder dem Schiedsrichter",
      repair: NEU_EINTRAGEN,
    }),
    "DB-COMMON-002": buildRefusal({ reason: "Der Spielbericht wurde gerade gleichzeitig gespeichert", repair: NEU_EINTRAGEN }),
  },
};

/** A report write's refusal in its reader's words, `null` for a code neither write answers. */
export function mapSpielberichtRefusal(error: unknown, leser: SpielberichtLeser): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error) || error.serverErrorCode === undefined) return null;

  const saetze = SAETZE[leser];
  // Own keys alone, so a code spelling an inherited member never reads as worded.
  return Object.hasOwn(saetze, error.serverErrorCode) ? { error: saetze[error.serverErrorCode] } : null;
}
