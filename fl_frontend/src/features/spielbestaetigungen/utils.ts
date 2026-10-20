import { hasTakenPlace } from "@/features/saisons/utils";
import { ansetzungGeaendert, tageBis, wirdAngefragt } from "@/features/spiele/components/forms/AdminEditSpielDataForm/banners";
import { CLASH_BUFFER_TEXT } from "@/features/spiele/constants";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { formatSpielDatum, formatUhrzeit, NICHT_HINTERLEGT } from "@/shared/utils/format";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { SpielBannerAnsetzung } from "@/features/spiele/components/forms/AdminEditSpielDataForm/banners";
import type { FLSpiel } from "@/features/spiele/schemas";
import type { FieldErrors } from "@/shared/utils/validation";
import type { AntwortStand } from "./constants";
import type {
  FLSpielbestaetigung,
  FLSpielbestaetigungAnsichtResponse,
  FLSpielbestaetigungGrund,
  FLSpielbestaetigungTermin,
  FLSpielbestaetigungVon,
} from "./schemas";

/** Who answered, as a readout rather than a sentence: a seat's long label agrees with no one article. */
export function beantwortetVon(von: FLSpielbestaetigungVon): string {
  if (von.art === "admin") return "Verwaltung der Liga";
  if (von.art === "schiedsrichter") return "Schiedsrichterin oder Schiedsrichter";
  return KONTAKT_ROLLEN.find((eintrag) => eintrag.value === von.rolle)?.langform ?? NICHT_HINTERLEGT;
}

export const terminText = (termin: FLSpielbestaetigungTermin): string =>
  `${formatSpielDatum(termin.datum)} um ${formatUhrzeit(termin.uhrzeit)} Uhr`;

/** The inputs of a fixture's stand, as a stored fixture and a draft alike carry them. */
type AnsetzungsQuelle = {
  datum: string | null;
  uhrzeit: string | null;
  ort: { spielort_id: string } | null;
  team1: { team_id: string } | null;
  team2: { team_id: string } | null;
};

export const spielAnsetzung = (spiel: AnsetzungsQuelle): SpielBannerAnsetzung => ({
  datum: spiel.datum,
  uhrzeit: spiel.uhrzeit,
  spielortId: spiel.ort?.spielort_id ?? null,
  team1Id: spiel.team1?.team_id ?? null,
  team2Id: spiel.team2?.team_id ?? null,
});

const zeilenAnsetzung = ({ ansetzung }: FLSpielbestaetigung): SpielBannerAnsetzung => ({
  datum: ansetzung.datum,
  uhrzeit: ansetzung.uhrzeit,
  spielortId: ansetzung.spielort_id,
  team1Id: ansetzung.team1_id,
  team2Id: ansetzung.team2_id,
});

export function groupBestaetigungenBySpielId(
  bestaetigungen: readonly FLSpielbestaetigung[],
): ReadonlyMap<string, readonly FLSpielbestaetigung[]> {
  const grouped = new Map<string, FLSpielbestaetigung[]>();
  for (const zeile of bestaetigungen) grouped.set(zeile.spiel_id, [...(grouped.get(zeile.spiel_id) ?? []), zeile]);

  return grouped;
}

/** What the pass judges a row against on its fixture: the Ansetzung's inputs, whether it is decided, and its referee. */
export type BestaetigungsSpiel = {
  id: string;
  datum: string | null;
  uhrzeit: string | null;
  ort: { spielort_id: string } | null;
  team1: { team_id: string; tore: number | null } | null;
  team2: { team_id: string; tore: number | null } | null;
  ergebnis: FLSpiel["ergebnis"];
  elfmeterschiessen: FLSpiel["elfmeterschiessen"];
  sonderereignis: FLSpiel["sonderereignis"];
  schiedsrichter: { schiedsrichter_id: string } | null;
};

// `fl_backend/app/api/spielbestaetigungen/services.py :: GRUENDE_ENDING_AN_ANSWER`: a move never ends a discard.
const GRUENDE_ENDING_AN_ANSWER: ReadonlySet<FLSpielbestaetigungGrund> = new Set([
  "austritt",
  "spiel_entschieden",
  "abgesagt",
  "spiel_vergangen",
]);

/** `grund_to_close`, in its order: the first reason the pass would shut an unclosed row for. */
function grundZumSchliessen(
  zeile: FLSpielbestaetigung,
  spiel: BestaetigungsSpiel,
  { austritte, today }: { austritte: ReadonlyMap<string, string>; today: string },
): FLSpielbestaetigungGrund | null {
  const { ansetzung, partei } = zeile;
  if (hasTakenPlace(spiel)) return "spiel_entschieden";
  if (spiel.sonderereignis !== null) return "abgesagt";

  // On the fixture's day as it stands, or the row's where the fixture lost its date.
  const tag = spiel.datum ?? ansetzung.datum;
  const ausgetreten = [ansetzung.team1_id, ansetzung.team2_id].some((teamId) => {
    const austritt = austritte.get(teamId);
    return austritt !== undefined && austritt <= tag;
  });
  if (ausgetreten) return "austritt";

  if (partei.art === "schiedsrichter" && spiel.schiedsrichter?.schiedsrichter_id !== partei.schiedsrichter_id)
    return "schiedsrichter_gewechselt";
  if (ansetzungGeaendert(zeilenAnsetzung(zeile), spielAnsetzung(spiel))) return "ansetzung_geaendert";

  return ansetzung.datum < today ? "spiel_vergangen" : null;
}

/**
 * `fl_backend/app/api/spielbestaetigungen/services.py :: grund_to_end` spelled again: why the next pass shuts a row
 * still holding its party's question, or `null`. Both tiers run one table of it (`docs/frontend/spec.md :: I783`).
 */
export function grundZumEnde(
  zeile: FLSpielbestaetigung,
  spiel: BestaetigungsSpiel,
  umstand: { austritte: ReadonlyMap<string, string>; today: string },
): FLSpielbestaetigungGrund | null {
  const grund = grundZumSchliessen(zeile, spiel, umstand);
  if (zeile.geschlossen === null || (grund !== null && GRUENDE_ENDING_AN_ANSWER.has(grund))) return grund;

  return zeile.ansetzung.datum < umstand.today ? "spiel_vergangen" : null;
}

/**
 * The rows that still speak for the fixture as it stands (`docs/frontend/spec.md :: I783`): nothing the next pass ends,
 * and about the Ansetzung it holds, as the public card reads a discard. Any other chips an answer the pass drops.
 */
export function geltendeBestaetigungen(
  bestaetigungen: readonly FLSpielbestaetigung[],
  spiel: BestaetigungsSpiel,
  umstand: { austritte: ReadonlyMap<string, string>; today: string },
): FLSpielbestaetigung[] {
  const jetzt = spielAnsetzung(spiel);

  return bestaetigungen.filter(
    (zeile) =>
      zeile.spiel_id === spiel.id &&
      (zeile.geschlossen === null || zeile.geschlossen.grund === "verworfen") &&
      !ansetzungGeaendert(zeilenAnsetzung(zeile), jetzt) &&
      grundZumEnde(zeile, spiel, umstand) === null,
  );
}

// The three triage predicates over a row `geltendeBestaetigungen` kept, each a club's row alone: a referee answers
// until the match day rather than by the row's deadline, and their decline is a category of its own.

export const istVorschlagOffen = (zeile: FLSpielbestaetigung): boolean =>
  zeile.partei.art === "team" && zeile.geschlossen === null && zeile.antwort?.art === "abgelehnt" && zeile.antwort.vorschlag !== null;

export const istUeberfaellig = (zeile: FLSpielbestaetigung, today: string): boolean =>
  zeile.partei.art === "team" && zeile.antwort === null && zeile.frist < today;

/**
 * Due on the day it is asked: no mint day is stored, so a row due today and asked today or not yet stands for one
 * minted inside the deadline's days. The backend's queue reads the same three fields.
 */
export const istSofortFaellig = (zeile: FLSpielbestaetigung, today: string): boolean =>
  zeile.partei.art === "team" &&
  zeile.antwort === null &&
  zeile.frist === today &&
  (zeile.angefragt_am === null || zeile.angefragt_am === today);

/**
 * The referee's own decline while the slot it emptied stays empty. Never among `geltendeBestaetigungen`: the decline
 * closes its row in its own write. The newest referee row decides (the read serves newest first), so a later booking
 * ends it.
 */
export function schiedsrichterAbsage(
  bestaetigungen: readonly FLSpielbestaetigung[],
  spiel: { id: string; schiedsrichter: object | null },
): FLSpielbestaetigung | undefined {
  if (spiel.schiedsrichter !== null) return undefined;
  const zeile = bestaetigungen.find((kandidat) => kandidat.spiel_id === spiel.id && kandidat.partei.art === "schiedsrichter");

  return zeile?.geschlossen?.grund === "schiedsrichter_abgelehnt" ? zeile : undefined;
}

export function antwortStand(zeile: FLSpielbestaetigung, today: string): AntwortStand {
  if (zeile.geschlossen?.grund === "verworfen") return "verworfen";
  if (zeile.antwort !== null) return zeile.antwort.art;
  return istUeberfaellig(zeile, today) ? "ueberfaellig" : "offen";
}

/**
 * Due and unrun: armed, a fixture the pass asks about, and no stamp since yesterday (`docs/ops/runbooks.md` §9).
 * Guarded on the stamp alone, it would warn on every fixture no pass ever visits.
 */
export function laufUeberfaellig({
  isSpielSweepOn,
  isActiveSaison,
  spiel,
  austritte,
  gelaufenAm,
  today,
}: {
  isSpielSweepOn: boolean;
  isActiveSaison: boolean;
  spiel: BestaetigungsSpiel;
  austritte: ReadonlyMap<string, string>;
  gelaufenAm: string | null;
  today: string;
}): boolean {
  const angefragt = wirdAngefragt(spielAnsetzung(spiel), {
    isActiveSaison,
    sonderereignis: spiel.sonderereignis,
    hasAnyTore: (spiel.team1?.tore ?? null) !== null || (spiel.team2?.tore ?? null) !== null,
    hasShootOut: spiel.elfmeterschiessen !== null,
    austrittTage: [spiel.team1, spiel.team2].flatMap((seite) => {
      const austritt = seite === null ? undefined : austritte.get(seite.team_id);
      return austritt === undefined ? [] : [austritt];
    }),
    today,
  });
  if (!isSpielSweepOn || !angefragt) return false;

  // Yesterday's stamp is a healthy stack's: the hourly pass's last run may fall before midnight.
  return gelaufenAm === null || tageBis(gelaufenAm, today) < -1;
}

/**
 * The settle's and the discard's state refusals: the panel showed a state read earlier, so the repair is the reload.
 * `null` hands every other code to the shared reader.
 */
export function mapSpielbestaetigungAdminRefusal(error: unknown): { error: string } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-ANSETZUNG-013":
      return { error: buildRefusal({ reason: "Diese Anfrage ist inzwischen beantwortet oder geschlossen", repair: LADE_DIE_SEITE_NEU }) };
    case "REQ-ANSETZUNG-014":
      return { error: buildRefusal({ reason: "Diese Antwort trägt keinen offenen Terminvorschlag mehr", repair: LADE_DIE_SEITE_NEU }) };
    default:
      return null;
  }
}

/**
 * What one link opens, narrowed before the page: an answerable link carries the whole view, an
 * answered one the role that answered and nothing else, every other state the state alone.
 */
export type SpielbestaetigungAnsicht =
  // A member per state, never one for the pair: a union keyed on a union of literals narrows on neither.
  | { zustand: "gueltig"; ansicht: FLSpielbestaetigungAnsichtResponse }
  | { zustand: "vorschlag"; ansicht: FLSpielbestaetigungAnsichtResponse }
  | { zustand: "zugesagt"; beantwortet_von: FLSpielbestaetigungVon }
  | { zustand: "abgelehnt"; beantwortet_von: FLSpielbestaetigungVon }
  // `termin-vorbei` is the page's own: an `abgelaufen` link whose fixture's day has gone by.
  | { zustand: "abgelaufen" | "termin-vorbei" | "ungueltig" | "gesperrt" };

/** Every state a link opens on once no press can spend it. */
export type SpielbestaetigungLinkZustand = Exclude<SpielbestaetigungAnsicht["zustand"], "gueltig" | "vorschlag">;

/** A press the backend refused, as the route answers it: a link's state, a box's message, or a sentence. */
export type SpielbestaetigungRefusal = {
  error?: string;
  fieldErrors?: FieldErrors;
  unplacedError?: string;
  zustand?: SpielbestaetigungLinkZustand;
  /** The route's instruction to read the link back, never a key the page receives. */
  nachlesen?: true;
};

/**
 * A refused read as the panel it renders, or `null` where the read failed instead.
 *
 * A token the backend will not parse matches no row, so the page calls the link void rather than
 * offering a reload that cannot succeed.
 */
export function mapAnsetzungAnsichtRefusal(error: unknown): "ungueltig" | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "REQ-VAL-001") return "ungueltig";

  // Every rule's refusal alike: a spent link answers its own `zustand` in a 200, so a refusal is a
  // token nothing could place, and a code nobody planned reads the same way.
  return isRuleRefusal(error) ? "ungueltig" : null;
}

/**
 * The answer's refusals, worded once for every page that sends one. `null` where the code is none of
 * these, which the route lets reach its spine.
 */
export function mapAnsetzungRefusal(error: unknown): SpielbestaetigungRefusal | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refusal no box can take is of a drifted client, which the
    // mail's link replaces.
    case "REQ-VAL-002":
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    // A token nothing stores, a voided seat's included, and a fixture moved since the link: one panel,
    // which tells a guessed link nothing about a row.
    case "REQ-ANSETZUNG-001":
    case "REQ-ANSETZUNG-004":
      return { zustand: "ungueltig" };
    // Each covers several states the read tells apart: `-002` both answers, where „zugesagt“ would tell a
    // club that declined in another window it confirmed; `-009` every closing reason, so the press shows
    // the panel a reload would.
    case "REQ-ANSETZUNG-002":
    case "REQ-ANSETZUNG-009":
    // Spent either way, but only the read carries whether the fixture's day has gone by, which has a panel of its own.
    case "REQ-ANSETZUNG-003":
    case "REQ-ANSETZUNG-005":
      return { nachlesen: true };
    // The panel the view opens a barred link on, so a ban entered while the form stood open leaves no form either.
    case "REQ-ANSETZUNG-011":
      return { zustand: "gesperrt" };
    // The proposal's refusals spend nothing: each lands on the box that caused it, and the typed
    // proposal survives it.
    case "REQ-ANSETZUNG-007":
      return { fieldErrors: { "vorschlag.datum": "Dieses Datum liegt in der Vergangenheit." } };
    case "REQ-DATE-001":
      return { fieldErrors: { "vorschlag.datum": "Dieses Datum liegt außerhalb des Spieltags." } };
    case "REQ-ELIGIBILITY-001":
      return { fieldErrors: { "vorschlag.datum": "An diesem Datum spielt eines der beiden Teams nicht mehr in der Saison." } };
    // The failure names neither the venue nor the referee, and either moves with the date as much as
    // with the time, so no one box takes it.
    case "REQ-CLASH-001":
      return {
        error: buildRefusal({
          reason: "Zu dieser Zeit ist der Spielort oder die Schiedsrichterin oder der Schiedsrichter schon für ein anderes Spiel eingeteilt",
          repair: `Schlag einen anderen Tag vor, oder eine Uhrzeit mit mindestens ${CLASH_BUFFER_TEXT} Abstand`,
        }),
      };
    default:
      return null;
  }
}

/** A referee's two answers' toast titles, each failure the negation of its success (`docs/frontend/spec.md :: I250`). */
export const ZUSAGE_GESPEICHERT = "Deine Zusage ist gespeichert";
export const ZUSAGE_NICHT_GESPEICHERT = "Deine Zusage wurde nicht gespeichert";
export const ABSAGE_GESPEICHERT = "Deine Absage ist gespeichert";
export const ABSAGE_NICHT_GESPEICHERT = "Deine Absage wurde nicht gespeichert";

/** Every spent row's repair: the panel re-read shows the row as it stands, which a refused press never redraws. */
const NEU_LADEN = "Lade die Seite neu.";

/**
 * A referee's answer's refusals, as their own panel words them: the link page's column reads a club's link, which a
 * referee holds none of. `null` where the code is none of these, which the person spine answers.
 */
export function mapSchiedsrichterAntwortRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors; unplacedError?: string } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refusal the reason box cannot take is of a page older than the running one.
    case "REQ-VAL-002":
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, "Lade die Seite neu und antworte erneut.");
    // Ahead of the shared reader's sentence, which names a team.
    case "REQ-FUNKTION-001":
      return { error: `Du bist nicht mehr als Schiedsrichterin oder Schiedsrichter eingetragen. ${NEU_LADEN}` };
    case "REQ-ANSETZUNG-015":
      return { error: `Für dieses Spiel bist Du nicht eingeteilt. ${NEU_LADEN}` };
    case "REQ-ANSETZUNG-002":
      return { error: `Auf diese Einteilung hast Du schon geantwortet. ${NEU_LADEN}` };
    case "REQ-ANSETZUNG-009":
      return { error: `Diese Einteilung ist schon abgeschlossen. ${NEU_LADEN}` };
    case "REQ-ANSETZUNG-005":
      return { error: `Das Spiel ist entschieden oder abgesagt, oder ein Team spielt nicht mehr mit. ${NEU_LADEN}` };
    case "REQ-ANSETZUNG-004":
      return { error: `Das Spiel hat einen neuen Termin, oder Du bist nicht mehr eingeteilt. ${NEU_LADEN}` };
    // A referee's answer keeps no deadline, so the day alone spends it.
    case "REQ-ANSETZUNG-003":
      return { error: `Das Spiel liegt schon in der Vergangenheit. ${NEU_LADEN}` };
    default:
      return null;
  }
}
