import { kaderName, NUMMER_NICHT_HINTERLEGT, SPIELER_ANONYM_LABEL } from "@/features/spieler/constants";
import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";

import type { Code, FLSpielberichtSpiel, FLSpielberichtSpieler } from "@/core/generated/client/types";
import type { FieldErrors } from "@/shared/utils/validation";

/** A pupil as a report's reader sees them: shirt number and name, and a pupil an erasure took as „anonym“. */
export function spielerLabel(spieler: FLSpielberichtSpieler): string {
  if (spieler.vorname === null) return SPIELER_ANONYM_LABEL;

  return `${spieler.nummer ?? NUMMER_NICHT_HINTERLEGT} · ${kaderName({ vorname: spieler.vorname, nachname: spieler.nachname })}`;
}

/** Why a fixture takes no report today, `null` where it takes one, as `bericht_not_played` and `bericht_abgesagt` judge a write. */
export type BerichtSperre = "abgesagt" | "undatiert" | "kuenftig";

export function berichtSperre(spiel: Pick<FLSpielberichtSpiel, "datum" | "sonderereignis">, today: string): BerichtSperre | null {
  if (spiel.sonderereignis === "ausgefallen" || spiel.sonderereignis === "annulliert") return "abgesagt";
  if (spiel.datum === null) return "undatiert";
  return spiel.datum > today ? "kuenftig" : null;
}

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

const SAETZE: Readonly<Record<string, string>> = {
  // Ahead of the spine's own reading, whose sentence names a team: the referee's record is what went.
  role_not_held: "Du bist nicht mehr als Schiedsrichterin oder Schiedsrichter eingetragen. Lade die Seite neu.",
  bericht_not_played: buildRefusal({
    reason: "Dieses Spiel hat noch kein Datum oder noch nicht stattgefunden",
    repair: LADE_DIE_SEITE_NEU,
  }),
  bericht_not_officiated: buildRefusal({ reason: "Dieses Spiel leitest Du nicht mehr", repair: LADE_DIE_SEITE_NEU }),
  bericht_not_in_kader: buildRefusal({
    reason: "Eine gewählte Person steht nicht mehr im Kader ihres Teams",
    repair: "Lade die Seite neu und wähle neu",
  }),
  bericht_abgesagt: buildRefusal({
    reason: "Dieses Spiel ist inzwischen als ausgefallen oder annulliert eingetragen und nimmt keinen Spielbericht an",
    repair: LADE_DIE_SEITE_NEU,
  }),
  bericht_grund_missing: GRUND_FEHLT,
  bericht_elfmeter_in_the_gruppe: ELFMETER_IN_DER_GRUPPE,
  saison_past: buildRefusal({
    reason: "Die Saison dieses Spiels ist vorbei, und den Spielbericht kannst Du nicht mehr ändern",
    repair: LADE_DIE_SEITE_NEU,
  }),
  // Its referee is the report's one writer, so the other write is their own, from another window.
  bericht_meanwhile_changed: buildRefusal({
    reason: "Der Spielbericht wurde inzwischen geändert, etwa von Dir in einem anderen Fenster",
    repair: NEU_EINTRAGEN,
  }),
  duplicate_key: buildRefusal({ reason: "Der Spielbericht wurde gerade gleichzeitig gespeichert", repair: NEU_EINTRAGEN }),
} satisfies Partial<Record<Code, string>>;

/** The referee's report write's refusal in their words, `null` for a code the write does not answer. */
export function mapSpielberichtRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error) || error.serverErrorCode === undefined) return null;

  // Own keys alone, so a code spelling an inherited member never reads as worded.
  return Object.hasOwn(SAETZE, error.serverErrorCode) ? { error: SAETZE[error.serverErrorCode] } : null;
}
