import { SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
import { formatSpielDatum, formatUhrzeit, PLACEHOLDER } from "@/shared/utils/format";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { FLGruppenNames } from "@/features/teams/schemas";
import type {
  FLBracketFault,
  FLPatchSpielDataPayload,
  FLSpiel,
  FLSpielAdvancement,
  FLSpielQuelle,
  FLSpielReleasedSide,
  FLSpielStatus,
  FLSpielTeamField,
  FLSpielTeamFieldJoined,
} from "./schemas";

/**
 * A label, not the server's filter: cancellation outranks the date and today is its own status.
 * The two definitions are `docs/glossary.md` — spiel_status.
 */
export const computeSpielStatus = ({
  datum,
  isCanceled,
  today,
}: {
  datum: string | null;
  isCanceled: boolean;
  today: string;
}): FLSpielStatus => {
  if (isCanceled) return "abgesagt";
  if (datum === null) return "unbekannt";
  if (datum > today) return "ausstehend";
  if (datum === today) return "heute";
  return "vergangen";
};

/** The one derivation the three `SpielCard` variants share; they stay separate themselves. */
export const formatSpielDisplay = (spiel: Pick<FLSpiel, "datum" | "uhrzeit" | "ergebnis" | "elfmeterschiessen">) => ({
  datum: formatSpielDatum(spiel.datum),
  uhrzeit: formatUhrzeit(spiel.uhrzeit),
  ergebnis: spiel.ergebnis ?? PLACEHOLDER.ergebnis,
  elfmeterschiessen: formatElfmeterschiessen(spiel.elfmeterschiessen),
});

/**
 * Returned beside the score and never folded into it, the table counting the fixture as the draw
 * it finished as. The spaces are `\u202F` escapes: a narrow no-break space holds the token on one
 * line and reads as a plain space in an editor.
 */
export const formatElfmeterschiessen = (elfmeterschiessen: FLSpiel["elfmeterschiessen"]): string | null =>
  elfmeterschiessen === null ? null : `${elfmeterschiessen.team1}:${elfmeterschiessen.team2}\u202Fi.\u202FE.`;

/** Win / loss / draw / unknown, from one team's point of view. */
export type FLSpielErgebnisFor = "W" | "L" | "D" | "?";

/**
 * Kept in step with `FLSpielSchema.ergebnis`, which enforces the same shape at the API boundary.
 * `[0-9]`, not `\d`: the backend's rust-regex `\d` is Unicode-aware, and `Number("٢")` is `NaN`.
 */
const ERGEBNIS_PATTERN = /^([0-9]+):([0-9]+)$/;

/**
 * Which side a team stands on, `null` for neither — the third answer being the point. A two-way
 * branch reads a team that is not in the fixture as team2, scoring it from the wrong side.
 */
const sideOf = (spiel: Pick<FLSpiel, "team1" | "team2">, teamId: string): 1 | 2 | null =>
  teamId === spiel.team1?.team_id ? 1 : teamId === spiel.team2?.team_id ? 2 : null;

/** "?" wherever the answer is not certain, so no team is shown a result it did not earn. */
export const computeErgebnisFor = ({ spiel, teamId }: { spiel: FLSpiel; teamId: string }): FLSpielErgebnisFor => {
  // Matched, not split on ":": Number("") is 0, so ":" would read as a 0:0 draw and "3:" as a win.
  const match = spiel.ergebnis?.match(ERGEBNIS_PATTERN);
  if (!match) return "?";

  const side = sideOf(spiel, teamId);
  if (side === null) return "?";

  const own = Number(match[side]);
  const other = Number(match[side === 1 ? 2 : 1]);

  return own === other ? "D" : own > other ? "W" : "L";
};

/**
 * The bracket's German vocabulary, derived from the reference and stored nowhere — this is the
 * only place it exists. Every placing reads as an ordinal, "1. der Gruppe A" and never
 * "Gruppensieger A", so two slots compare at a glance.
 */
export const formatQuelle = (quelle: FLSpielQuelle | null): string | null => {
  if (quelle === null) return null;

  // A source mid-edit holds NaN where its number is unpicked. NaN is a `number` and type-checks, so
  // without this every consumer prints "Sieger NaN." while somebody chooses a feeder match.
  if (!Number.isInteger(quelle.type === "gruppe" ? quelle.platz : quelle.spiel_nr)) return null;

  if (quelle.type === "gruppe") {
    return `${quelle.platz}. der Gruppe ${quelle.gruppe}`;
  }

  return `${quelle.ausgang === "sieger" ? "Sieger" : "Verlierer"} ${quelle.spiel_nr}.`;
};

/**
 * What fills this side from here on. All four combinations of the two fields are legal stored
 * states, so it lives here once: two surfaces spelling `offen` apart is how the triage list and the
 * wiring review disagree about which fixtures need somebody.
 */
export type FLSlotHerkunft = "quelle" | "manuell" | "offen";

export const deriveSlotHerkunft = ({ team, quelle }: { team: FLSpielTeamField | null; quelle: FLSpielQuelle | null }): FLSlotHerkunft =>
  quelle !== null ? "quelle" : team !== null ? "manuell" : "offen";

/**
 * Mirrors `fl_backend/app/api/spiele/schemas.py :: PHASE_RANK` for the same rule: a bracket slot is
 * fed only from a strictly earlier round. Derived, not written out — a hand-written map compiles
 * with a newly added round ranked nowhere.
 */
export const PHASE_RANK: Record<FLSaisonPhase, number> = Object.fromEntries(SAISON_PHASE_OPTIONS.map((phase, rank) => [phase, rank])) as Record<
  FLSaisonPhase,
  number
>;

/**
 * A string rather than the object, so two structurally equal references collide where object
 * identity would let them pass. The variant tag leads: `spiel` 1 must not collide with `platz` 1.
 */
export const quelleKey = (quelle: FLSpielQuelle): string =>
  quelle.type === "spiel" ? `spiel:${quelle.spiel_nr}:${quelle.ausgang}` : `gruppe:${quelle.gruppe}:${quelle.platz}`;

/**
 * Excluded by fixture, not by slot: the edited fixture re-submits its own stored sources rather
 * than duplicating them, and its two sides are the caller's to check — only it holds the draft.
 */
export const collectUsedQuelleKeys = (saisonSpiele: readonly FLSpiel[], editedSpielId: string): Set<string> => {
  const used = new Set<string>();

  for (const spiel of saisonSpiele) {
    if (spiel.id === editedSpielId) continue;
    for (const quelle of [spiel.team1_quelle, spiel.team2_quelle]) {
      if (quelle !== null) used.add(quelleKey(quelle));
    }
  }

  return used;
};

/**
 * A team plays at most once per Spieltag, so this is what lets the picker say which fixture
 * already holds it rather than accepting a pick the write path then refuses. Stored sides only.
 */
export const collectSpieltagTeamOccupancy = (
  saisonSpiele: readonly FLSpiel[],
  edited: Pick<FLSpiel, "id" | "spieltag_id">,
): Map<string, number> => {
  const occupancy = new Map<string, number>();

  for (const spiel of saisonSpiele) {
    if (spiel.id === edited.id || spiel.spieltag_id !== edited.spieltag_id) continue;
    for (const side of [spiel.team1, spiel.team2]) {
      if (side !== null) occupancy.set(side.team_id, spiel.spiel_nr);
    }
  }

  return occupancy;
};

/**
 * A proxy for "qualified", never a derivation: it reads the bracket as stored. It therefore feeds a
 * warning and never a refusal — an admin correcting a hand-run season may know better.
 */
export const collectKnockoutTeamIds = (saisonSpiele: readonly FLSpiel[], editedSpielId: string): Set<string> => {
  const teamIds = new Set<string>();

  for (const spiel of saisonSpiele) {
    if (spiel.id === editedSpielId || spiel.saison_phase === "gruppenphase") continue;
    for (const side of [spiel.team1, spiel.team2]) {
      if (side !== null) teamIds.add(side.team_id);
    }
  }

  return teamIds;
};

/**
 * Marks the picker's recommendation. Its list legitimately spans every earlier round — a final may
 * be fed from the quarter-finals — so this is what says which of them the bracket ordinarily means.
 */
export const isDirectlyPrecedingRound = (feeder: Pick<FLSpiel, "saison_phase">, target: Pick<FLSpiel, "saison_phase">): boolean =>
  PHASE_RANK[feeder.saison_phase] === PHASE_RANK[target.saison_phase] - 1;

/**
 * Strictly earlier is what makes a cycle unpickable: every offered edge points backwards, so no
 * chain of them closes. The season filter matters because the caller's list can span seasons.
 */
export const listFeederSpiele = (saisonSpiele: readonly FLSpiel[], target: Pick<FLSpiel, "id" | "saison_id" | "saison_phase">): FLSpiel[] =>
  saisonSpiele
    .filter(
      (spiel) =>
        spiel.saison_id === target.saison_id &&
        spiel.id !== target.id &&
        spiel.saison_phase !== "gruppenphase" &&
        PHASE_RANK[spiel.saison_phase] < PHASE_RANK[target.saison_phase],
    )
    .sort((a, b) => a.spiel_nr - b.spiel_nr);

/**
 * Structural typing accepts the joined side wherever the stored shape is asked for, so without this
 * the join rides through the draft onto the write path. Fields are listed rather than omitted by
 * key, so a new join field stays out by default.
 */
export const toStoredSide = (side: FLSpielTeamFieldJoined | null): FLSpielTeamField | null =>
  side === null ? null : { team_id: side.team_id, name: side.name, tore: side.tore, shorthand: side.shorthand };

/**
 * One stored fixture as the payload restoring it, the loaded page being the only place the old
 * values still exist. Every field is listed rather than spread: the write path `$set`s wholesale,
 * so one omitted is overwritten with nothing.
 */
export const toPatchPayload = (spiel: FLSpiel): FLPatchSpielDataPayload => ({
  // No `ergebnis`: the backend derives it from the goals and refuses to accept one
  // (`docs/backend/spec.md` I3).
  spiel_id: spiel.id,
  is_canceled: spiel.is_canceled,
  team1: toStoredSide(spiel.team1),
  team2: toStoredSide(spiel.team2),
  team1_quelle: spiel.team1_quelle,
  team2_quelle: spiel.team2_quelle,
  elfmeterschiessen: spiel.elfmeterschiessen,
  datum: spiel.datum,
  uhrzeit: spiel.uhrzeit,
  ort: spiel.ort,
  schiedsrichter: spiel.schiedsrichter,
  notiz: spiel.notiz,
});

/**
 * [Resets the match editor's state](https://react.dev/learn/preserving-and-resetting-state#resetting-state-with-a-key)
 * when an undo restores values — the fixture id alone would keep showing what the mounted editor
 * was seeded with until a reload.
 */
export const spielStateKey = (spiel: FLSpiel): string => `${spiel.id}:${JSON.stringify(toPatchPayload(spiel))}`;

/**
 * **Order is the whole correctness argument.** The edited fixture goes first, so the resolution
 * puts the occupants back downstream before each voided result is written. Reversed, the undo
 * reports success having restored nothing.
 */
export const buildUndoPayloads = (
  edited: FLSpiel,
  saisonSpiele: readonly FLSpiel[],
  affectedSpielNummern: readonly number[],
): FLPatchSpielDataPayload[] => {
  const affected = new Set(affectedSpielNummern);

  return [
    toPatchPayload(edited),
    ...saisonSpiele.filter((spiel) => spiel.id !== edited.id && affected.has(spiel.spiel_nr)).map(toPatchPayload),
  ];
};

/** The one spelling of the route, so a renamed segment cannot leave two surfaces disagreeing. */
export const adminSpielEditHref = (spielId: string): string => `/admin/spiele/${spielId}`;

/**
 * The inverse of `listFeederSpiele`, over stored wiring. **Both routes matter**: a slot naming this
 * match, and a slot seeded from a group this match is played in. This states the wiring; the dry
 * run names what is actually voided.
 */
export const listDependentSpiele = (
  saisonSpiele: readonly FLSpiel[],
  spiel: Pick<FLSpiel, "id" | "saison_id" | "saison_phase" | "spiel_nr">,
  gruppen: readonly FLGruppenNames[],
): FLSpiel[] => {
  // `gruppen` is passed in because a match document does not carry it.
  const seedsFromThisGruppe = (quelle: FLSpielQuelle): boolean =>
    quelle.type === "gruppe" && spiel.saison_phase === "gruppenphase" && gruppen.includes(quelle.gruppe);

  return saisonSpiele
    .filter(
      (candidate) =>
        candidate.saison_id === spiel.saison_id &&
        candidate.id !== spiel.id &&
        // `ausgang` is not compared: either outcome moves the slot.
        [candidate.team1_quelle, candidate.team2_quelle].some(
          (quelle) => quelle !== null && ((quelle.type === "spiel" && quelle.spiel_nr === spiel.spiel_nr) || seedsFromThisGruppe(quelle)),
        ),
    )
    .sort((a, b) => a.spiel_nr - b.spiel_nr);
};

/**
 * **"aktualisiert", not "eingetragen"**: `advanced_to` reports an emptied slot as readily as a
 * filled one. **`Paarung`, not `Aufstellung`** — the site stores a starting line-up too. Silence is
 * how an admin knows the later round did not move.
 */
export const formatSpielUpdateMessage = (
  advancedTo: readonly FLSpielAdvancement[],
  bracketFaults: readonly FLBracketFault[] = [],
  releasedSides: readonly FLSpielReleasedSide[] = [],
): string => {
  const sentences = ["Die Spieldaten wurden erfolgreich aktualisiert"];

  if (advancedTo.length > 0) {
    sentences.push(
      advancedTo.length === 1
        ? `Die Paarung in Spiel ${joinSpiele(advancedTo)} wurde ebenfalls aktualisiert`
        : `Die Paarungen in den Spielen ${joinSpiele(advancedTo)} wurden ebenfalls aktualisiert`,
    );
  }

  // Its own sentence: a cleared result is a different fact from a slot changing occupant, and a
  // message about a Paarung tells an admin nothing about the scoreline they just deleted.
  const voided = advancedTo.filter((advancement) => advancement.voided_ergebnis !== null);
  if (voided.length > 0) {
    sentences.push(
      voided.length === 1
        ? `Das eingetragene Ergebnis in Spiel ${joinSpiele(voided)} wurde dabei gelöscht`
        : `Die eingetragenen Ergebnisse in den Spielen ${joinSpiele(voided)} wurden dabei gelöscht`,
    );
  }

  // The endpoint's other write: fielding a team here removes it from its other fixture on the same
  // Spieltag. Named per fixture, since the admin has to know which match is now short a side.
  for (const released of releasedSides) {
    sentences.push(
      released.voided_ergebnis === null
        ? `${released.team_name} wurde aus Spiel ${released.spiel_nr} entfernt, da beide am selben Spieltag stattfinden`
        : `${released.team_name} wurde aus Spiel ${released.spiel_nr} entfernt, dessen Ergebnis ${released.voided_ergebnis} damit gelöscht wurde`,
    );
  }

  // Named individually rather than counted: "zwei Bracket-Verweise sind offen" is not actionable.
  sentences.push(...bracketFaults.map(formatBracketFault));

  return sentences.join(". ");
};

/** `Intl.ListFormat` over a hand-rolled join: German's "und" and missing serial comma are free. */
const joinSpiele = (advancements: readonly { spiel_nr: number }[]): string =>
  new Intl.ListFormat("de-DE", { style: "long", type: "conjunction" }).format(advancements.map((entry) => String(entry.spiel_nr)));

/**
 * For the save's toast, which arrives with no fixture in sight — so every sentence names its match
 * number. Only states no further result can fix reach here. Beside a card, use
 * `describeBracketFaultOnCard`.
 */
export const formatBracketFault = (fault: FLBracketFault): string => {
  switch (fault.reason) {
    case "gruppe_too_small":
      return `Spiel ${fault.spiel_nr} verweist auf Platz ${fault.platz} der Gruppe ${fault.gruppe}, doch so weit reicht diese Gruppe nicht`;
    case "tie_unresolved":
      return `Platz ${fault.platz} der Gruppe ${fault.gruppe} ist auch nach der Gruppenphase nicht zu entscheiden, daher bleibt Spiel ${fault.spiel_nr} offen`;
    case "spiel_missing":
      return `Spiel ${fault.spiel_nr} verweist auf Spiel ${fault.quelle_spiel_nr}, das es in dieser Saison nicht gibt`;
    case "reference_cycle":
      return `Spiel ${fault.spiel_nr} verweist über Spiel ${fault.quelle_spiel_nr} auf eine Verweiskette, die sich schließt und kein Ergebnis liefern kann`;
    case "same_team":
      return `In Spiel ${fault.spiel_nr} führen beide Seiten zur selben Mannschaft`;
    // Not a bracket fault: what makes it one is the order of the two dates, and the fixture's own
    // may be missing — so the sentence names both rather than a reference.
    case "disqualified_occupant":
      return fault.spiel_datum === null
        ? `In Spiel ${fault.spiel_nr} steht ${fault.team_name}, disqualifiziert seit ${formatSpielDatum(fault.disqualifiziert_seit)}. Das Spiel hat kein Datum, also ist nicht belegt, dass es vorher stattfand`
        : `Spiel ${fault.spiel_nr} am ${formatSpielDatum(fault.spiel_datum)} führt ${fault.team_name}, disqualifiziert seit ${formatSpielDatum(fault.disqualifiziert_seit)}`;
  }
};

/**
 * The same faults for a note beside the fixture: plainer German, naming only what the card does not
 * already show, since it leads with the match number `formatBracketFault` has to spell out.
 */
export const describeBracketFaultOnCard = (fault: FLBracketFault): string => {
  switch (fault.reason) {
    case "gruppe_too_small":
      return `Verweist auf Platz ${fault.platz} der Gruppe ${fault.gruppe}. So viele Plätze hat diese Gruppe nicht.`;
    case "tie_unresolved":
      return `Platz ${fault.platz} der Gruppe ${fault.gruppe} ist auch nach der Gruppenphase nicht entschieden. Dieses Spiel bleibt deshalb offen.`;
    case "spiel_missing":
      return `Verweist auf Spiel ${fault.quelle_spiel_nr}, das es in dieser Saison nicht gibt.`;
    case "reference_cycle":
      return `Der Verweis über Spiel ${fault.quelle_spiel_nr} führt im Kreis und kann nie ein Ergebnis liefern.`;
    case "same_team":
      return "Beide Seiten führen zur selben Mannschaft.";
    case "disqualified_occupant":
      return fault.spiel_datum === null
        ? `${fault.team_name} ist seit dem ${formatSpielDatum(fault.disqualifiziert_seit)} disqualifiziert. Ohne Spieldatum ist nicht belegt, dass vorher gespielt wurde.`
        : `${fault.team_name} ist seit dem ${formatSpielDatum(fault.disqualifiziert_seit)} disqualifiziert, steht aber noch in diesem Spiel.`;
  }
};

/**
 * **Keyed on `spiel_id`, never `spiel_nr`**: the action-required route spans seasons and every
 * season has a match 29. A list rather than a sentence, since one fixture can carry several faults
 * that are corrected separately.
 */
export const groupBracketFaultsBySpielId = (faults: readonly FLBracketFault[]): ReadonlyMap<string, readonly string[]> => {
  const bySpielId = new Map<string, string[]>();

  for (const fault of faults) {
    const sentences = bySpielId.get(fault.spiel_id);
    if (sentences === undefined) bySpielId.set(fault.spiel_id, [describeBracketFaultOnCard(fault)]);
    else sentences.push(describeBracketFaultOnCard(fault));
  }

  return bySpielId;
};
