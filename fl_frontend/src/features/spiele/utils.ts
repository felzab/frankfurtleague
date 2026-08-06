/**
 * SPIELE · derivations
 *
 * Pure derivation over a Spiel — no I/O and no caching, which is why it stays out of `queries.ts`
 * rather than being folded in. Parsing `ergebnis` lives here because its format is declared by
 * `FLSpielSchema`: it is Spiel domain knowledge, not something a `teams` view should re-implement.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • `computeSpielStatus` treats cancellation as overriding the date. The server treats the two as
 *     independent filters, and its `ausstehend` includes today while this excludes it — see the
 *     glossary before assuming either side is wrong.
 *   • `computeErgebnisFor` returns "?" for anything it cannot read with certainty, including a team id
 *     that is neither side and a side with no occupant yet. A two-way branch would score an unknown
 *     team as team2 and render a confident loss for a team that did not play.
 *   • `computeErgebnisFor` reads `ergebnis` ALONE, so a knockout settled on penalties is a "D" here.
 *     That is deliberate and it matches the league table, which counts the fixture as a draw — only
 *     the bracket takes a winner from a shoot-out (ADR-0044).
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/glossary.md — spiel_status, for the two definitions and why they differ
 */

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
} from "./schemas";

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

/**
 * The three presentation values every match card derives. Extracted because the three cards had
 * copy-pasted them and one had drifted: an unplayed match rendered `"- : -"` in the main card and
 * `"-:-"` in the compact and playoff cards, on the same screen.
 *
 * **This is derivation only. The three `SpielCard` components stay separate** — they are justified
 * variance, not copy-paste (ADR-0007).
 */
export const formatSpielDisplay = (spiel: Pick<FLSpiel, "datum" | "uhrzeit" | "ergebnis" | "elfmeterschiessen">) => ({
  datum: formatSpielDatum(spiel.datum),
  uhrzeit: formatUhrzeit(spiel.uhrzeit),
  ergebnis: spiel.ergebnis ?? PLACEHOLDER.ergebnis,
  elfmeterschiessen: formatElfmeterschiessen(spiel.elfmeterschiessen),
});

/**
 * A shoot-out as the abbreviation German football writes it: `4:3 i. E.`, or `null` where none was
 * played — which is every match but a handful.
 *
 * **Returned beside the score and never folded into it.** The fixture finished level and the league
 * table counts it as a draw (ADR-0044), so a card that showed `4:3` where `2:2` belongs would state the
 * opposite of what the Saisontabelle does about the same match. Every caller renders the two together.
 *
 * `i. E.` is "im Elfmeterschießen". The two spaces are `\u202F`, a narrow no-break space, written as an
 * escape rather than pasted in: it is the character German typography sets an abbreviation with, it
 * keeps the whole token on one line on a narrow card, and it is invisible in an editor.
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
 * Derives a result for `teamId` from the `ergebnis` wire string.
 *
 * Parsing `ergebnis` is `spiele` domain knowledge — the format is declared by `FLSpielSchema` —
 * so it belongs here rather than inline in a `teams` view.
 *
 * Returns "?" for anything it cannot read with certainty, which covers four distinct cases:
 * an unplayed match (`ergebnis` is null), a malformed value, a side with no occupant yet, and a
 * `teamId` that is not one of the two competing teams. That last one matters — the obvious
 * `teamId === team1.team_id` two-way branch scores an unknown team from team2's point of view, so a
 * stale embedded id renders a confident **loss** for a team that did not play. That is the same
 * silent-loss defect this function was extracted to remove, one level up.
 */
export const computeErgebnisFor = ({ spiel, teamId }: { spiel: FLSpiel; teamId: string }): FLSpielErgebnisFor => {
  // Matched against the pattern FLSpielSchema.ergebnis enforces, rather than split on ":".
  // A length-2 check is not sufficient: ":" splits into two empty strings and Number("") is 0, not
  // NaN, so it would be read as a 0:0 draw. "3:" would read as a win.
  const match = spiel.ergebnis?.match(ERGEBNIS_PATTERN);
  if (!match) return "?";

  // Three-way, not two-way: neither side matching is "unknown", not "team2". An unresolved side
  // matches nothing, which is the same answer for the same reason.
  const side = teamId === spiel.team1?.team_id ? 1 : teamId === spiel.team2?.team_id ? 2 : null;
  if (side === null) return "?";

  const own = Number(match[side]);
  const other = Number(match[side === 1 ? 2 : 1]);

  return own === other ? "D" : own > other ? "W" : "L";
};

/**
 * What a card shows in place of a side whose occupant is not known yet.
 *
 * The label is DERIVED, never stored: `quelle` is a reference and carries no German (ADR-0042), so this
 * is the single place the bracket's vocabulary exists. `null` in means the slot has no source at all —
 * a group-phase fixture, or one an admin has taken manual charge of — and the caller falls through to
 * `PLACEHOLDER.slot`.
 *
 * "Gruppensieger A" rather than "1. der Gruppe A" for first place, because that is what the competition
 * calls it; every other placing reads as an ordinal.
 */
export const formatQuelle = (quelle: FLSpielQuelle | null): string | null => {
  if (quelle === null) return null;

  // A source mid-edit holds `NaN` where its number is still unpicked, which is a `number` and
  // type-checks — so without this guard every consumer printed "Sieger NaN." while somebody was
  // choosing a feeder match. `null` here means "nothing renderable yet", which callers already
  // handle: they fall through to the shared placeholder.
  if (!Number.isInteger(quelle.type === "gruppe" ? quelle.platz : quelle.spiel_nr)) return null;

  if (quelle.type === "gruppe") {
    return quelle.platz === 1 ? `Gruppensieger ${quelle.gruppe}` : `${quelle.platz}. der Gruppe ${quelle.gruppe}`;
  }

  return `${quelle.ausgang === "sieger" ? "Sieger" : "Verlierer"} ${quelle.spiel_nr}.`;
};

/**
 * The rounds in the order they are played. Mirrors `PHASE_RANK` in
 * `fl_backend/app/api/spiele/services.py`, and exists for the same rule: a bracket slot is fed only by
 * a knockout match of a strictly earlier round (ADR-0046). The form derives its legal options from
 * this; the backend refuses anything outside them.
 */
const PHASE_RANK: Record<FLSaisonPhase, number> = { gruppenphase: 0, viertelfinale: 1, halbfinale: 2, finale: 3 };

/**
 * One source as a comparable identity, so "this outcome already feeds a slot" is a set lookup.
 *
 * A string rather than the object, because two structurally equal references must collide and object
 * identity would let them pass. The variant tag leads, so `spiel` 1 can never collide with `platz` 1.
 */
export const quelleKey = (quelle: FLSpielQuelle): string =>
  quelle.type === "spiel" ? `spiel:${quelle.spiel_nr}:${quelle.ausgang}` : `gruppe:${quelle.gruppe}:${quelle.platz}`;

/**
 * Every source already feeding a slot of the season, excluding the fixture being edited.
 *
 * The exclusion is by fixture, not by slot: the edited fixture's own stored sources are re-submitted
 * rather than duplicated, and its two sides are checked against each other by the caller, which holds
 * their DRAFT state — this function only sees what is stored.
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
 * Which fixture of the same Spieltag already fields each team, excluding the fixture being edited.
 *
 * A team appears at most once per Spieltag — it cannot play two matches on one matchday — and this
 * map is what lets the picker say so where the answer is refused, instead of accepting a pick that
 * silently leaves the team in both fixtures. Stored sides only, like `collectUsedQuelleKeys`: other
 * fixtures' drafts are not visible here, and the edited fixture's own sides are the caller's to
 * check against its draft. The write-path refusal is the backend's half (ADR-0049's successor); this
 * is the UI half that makes the rule readable.
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
 * Every team a knockout fixture of the season fields, excluding the fixture being edited.
 *
 * The client's honest proxy for "qualified for the knockout stage": a team standing in no bracket
 * fixture at all has, as far as the stored season says, not advanced — and hand-picking it into a
 * knockout slot deserves a warning. It is a proxy, not a derivation: re-deriving who SHOULD have
 * advanced from the standings is exactly what ADR-0043 keeps out of the client, so this reads only
 * what the bracket already holds. A warning, never a refusal — an admin correcting a hand-run
 * season is allowed to know better.
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
 * Whether `feeder` plays in the round directly before `target`'s — the round a slot is ordinarily
 * fed from (ADR-0042), and therefore the recommendation the feeder picker marks. The picker's list
 * legitimately spans every earlier round; for a final that is quarter- AND semi-finals, and the
 * chip is what says which of them the bracket ordinarily means.
 */
export const isDirectlyPrecedingRound = (feeder: Pick<FLSpiel, "saison_phase">, target: Pick<FLSpiel, "saison_phase">): boolean =>
  PHASE_RANK[feeder.saison_phase] === PHASE_RANK[target.saison_phase] - 1;

/**
 * The matches a slot of `target` may legally be fed by: knockout matches of the same season in a
 * strictly earlier round, in bracket order (ADR-0046).
 *
 * Strictly earlier is also what makes a cycle unpickable — every offered edge points backwards in the
 * running order, so no chain of them can close. The season filter matters on the one surface whose
 * list can span seasons: feeding this the wrong season's matches would offer numbers the backend then
 * rightly refuses.
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
 * One stored fixture as the payload that would restore it.
 *
 * **What the undo toast is built from** (ADR-0051). A save that resolves the bracket can delete a
 * result somebody entered in a fixture the request never named, and nothing on the server keeps the
 * old value — no admin write is recorded anywhere (roadmap BE-15). The page that was looking at the
 * season is therefore the only place those values still exist, and this turns each of them back into
 * a request.
 *
 * Every field of the payload is listed rather than spread, and that is the point: the write path
 * `$set`s the payload wholesale, so a field omitted here would be **overwritten with nothing** by the
 * very request meant to restore it. `spiel_nr`, `spieltag_id`, `saison_id` and `saison_phase` are on
 * no payload and therefore not restorable — nothing writes them either, so there is nothing to undo.
 *
 * `ergebnis` is absent for the same reason it is absent from the payload model: the backend derives it
 * from the two goal counts and refuses to accept one (spec I3), so restoring the goals restores it.
 */
export const toPatchPayload = (spiel: FLSpiel): FLPatchSpielDataPayload => ({
  spiel_id: spiel.id,
  is_canceled: spiel.is_canceled,
  team1: spiel.team1,
  team2: spiel.team2,
  team1_quelle: spiel.team1_quelle,
  team2_quelle: spiel.team2_quelle,
  elfmeterschiessen: spiel.elfmeterschiessen,
  datum: spiel.datum,
  uhrzeit: spiel.uhrzeit,
  ort: spiel.ort,
  schiedsrichter: spiel.schiedsrichter,
});

/**
 * The requests that put a season back the way it was before one save (ADR-0051).
 *
 * **Order is the whole correctness argument.** The edited fixture goes first, because restoring it is
 * what makes the resolution put the occupants back downstream; each fixture whose result that save
 * destroyed follows, so its scoreline is written after the bracket has stopped moving under it. The
 * reverse order would have the resolution clear what the previous request had just restored, and the
 * undo would report success while restoring nothing.
 *
 * `affectedSpielNummern` are the fixtures the save reported — those whose result it voided and those a
 * team was released from. A fixture the season list does not hold is skipped rather than guessed at:
 * this is bounded to what the page loaded, which is exactly what makes it a page-session undo rather
 * than a history feature.
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

/**
 * Where one fixture is edited (ADR-0050).
 *
 * One spelling of the route, because three surfaces need it — the match cards, the action-required list,
 * and any later triage view that deep-links into a single fixture. A path built at each site is how two
 * of them end up disagreeing after the segment is renamed.
 */
export const adminSpielEditHref = (spielId: string): string => `/admin/spiele/${spielId}`;

/**
 * The fixtures whose occupants this one's result decides — the wiring the edit surface warns about
 * before a save (ADR-0048).
 *
 * The inverse direction to `listFeederSpiele`, and over stored wiring rather than legal candidates: a
 * fixture is dependent when it actually names this one as a source, or when it seeds a placing from a
 * group this fixture is played in.
 *
 * **Both routes matter, and the group one is the route an admin meets first.** A knockout slot fed by
 * `{type: "spiel"}` is voided when the match it names changes hands; a slot fed by `{type: "gruppe"}` is
 * voided when the standings that decide the placing change, which is what a corrected group result does
 * (ADR-0043). `ausgang` is not compared, because either outcome of this fixture moves the slot.
 *
 * `gruppen` is the groups this fixture is played in, which a match document does not carry — `FLSpiel`
 * embeds its sides and a group lives on the `saison_teams` junction the team list already joins
 * (ADR-0028). Empty for a knockout fixture, where the group route cannot apply.
 *
 * **This states the wiring; it does not predict the loss.** Whether a save actually voids a stored
 * result depends on running the resolution against the payload, which ADR-0048 rejects as a preview —
 * so a dependent fixture listed here is one whose result *can* be cleared, and the caller says so in
 * those words.
 */
export const listDependentSpiele = (
  saisonSpiele: readonly FLSpiel[],
  spiel: Pick<FLSpiel, "id" | "saison_id" | "saison_phase" | "spiel_nr">,
  gruppen: readonly FLGruppenNames[],
): FLSpiel[] => {
  const seedsFromThisGruppe = (quelle: FLSpielQuelle): boolean =>
    quelle.type === "gruppe" && spiel.saison_phase === "gruppenphase" && gruppen.includes(quelle.gruppe);

  return saisonSpiele
    .filter(
      (candidate) =>
        candidate.saison_id === spiel.saison_id &&
        candidate.id !== spiel.id &&
        [candidate.team1_quelle, candidate.team2_quelle].some(
          (quelle) => quelle !== null && ((quelle.type === "spiel" && quelle.spiel_nr === spiel.spiel_nr) || seedsFromThisGruppe(quelle)),
        ),
    )
    .sort((a, b) => a.spiel_nr - b.spiel_nr);
};

/**
 * The success message for an admin match edit, naming every fixture the write also moved and what
 * that cost.
 *
 * `PATCH /spiele/{spiel_id}` resolves the season's bracket, so entering a result can fill a later
 * fixture's slot — and correcting one can empty a slot that should never have been filled (ADR-0042).
 * The wording is therefore **"aktualisiert" rather than "eingetragen"**: `advanced_to` reports what
 * changed, and an emptied fixture is in it exactly as a filled one is.
 *
 * **A destroyed result gets its own sentence** (ADR-0051). A moved `Paarung` and a deleted scoreline
 * are two different facts, and a reader told specifically that a pairing changed reasonably concludes
 * the rest of the fixture did not.
 *
 * **`Paarung`, not `Aufstellung`.** What changed is which teams meet; an Aufstellung is the starting
 * line-up, which this site also stores, so the wrong word would name the wrong thing.
 *
 * Saying nothing when the lists are empty is the point of reporting at all: an admin who has just
 * entered a quarter-final result and sees no second sentence knows the semi-final did not move.
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

  // A sentence of its own, and this is the whole point of the shape change (ADR-0051). A cleared
  // result is a different fact about a different thing than a slot changing occupant, and the previous
  // message said only that a `Paarung` had been updated — so an admin who had just deleted a
  // semi-final scoreline read that a pairing moved and nothing about the score.
  const voided = advancedTo.filter((advancement) => advancement.voided_ergebnis !== null);
  if (voided.length > 0) {
    sentences.push(
      voided.length === 1
        ? `Das eingetragene Ergebnis in Spiel ${joinSpiele(voided)} wurde dabei gelöscht`
        : `Die eingetragenen Ergebnisse in den Spielen ${joinSpiele(voided)} wurden dabei gelöscht`,
    );
  }

  // The other write this endpoint can make: a team fielded here leaves the fixture it played on the
  // same Spieltag (ADR-0052). Named per fixture rather than counted, because the admin has to know
  // which side of which match is now empty.
  for (const released of releasedSides) {
    sentences.push(
      released.voided_ergebnis === null
        ? `${released.team_name} wurde aus Spiel ${released.spiel_nr} entfernt, da beide am selben Spieltag stattfinden`
        : `${released.team_name} wurde aus Spiel ${released.spiel_nr} entfernt, dessen Ergebnis ${released.voided_ergebnis} damit gelöscht wurde`,
    );
  }

  // Each fault is named individually rather than counted. There is at most a handful, and "zwei
  // Bracket-Verweise sind offen" tells an admin nothing they can act on.
  sentences.push(...bracketFaults.map(formatBracketFault));

  return sentences.join(". ");
};

/**
 * A list of fixtures as German writes it: "29, 30 und 31".
 *
 * `Intl.ListFormat` rather than a hand-rolled join, because German puts "und" before the last item
 * with no serial comma and the runtime already knows that.
 */
const joinSpiele = (advancements: readonly { spiel_nr: number }[]): string =>
  new Intl.ListFormat("de-DE", { style: "long", type: "conjunction" }).format(advancements.map((entry) => String(entry.spiel_nr)));

/**
 * Why one stored bracket fault needs a person, in a sentence an admin can act on (ADR-0047).
 *
 * Five reasons, and every one of them names the fixture to open and what is wrong inside it. Only states
 * no further result can fix reach here — a group that is still being played produces none of them,
 * because a placing that is not decided yet needs nobody's attention (ADR-0043).
 *
 * The same sentences serve the save's toast and the action-required list, so a fault reads identically
 * wherever an admin meets it.
 */
export const formatBracketFault = (fault: FLBracketFault): string => {
  switch (fault.reason) {
    case "gruppe_too_small":
      return `Spiel ${fault.spiel_nr} verweist auf Platz ${fault.platz} der Gruppe ${fault.gruppe} — so weit reicht diese Gruppe nicht`;
    case "tie_unresolved":
      return `Platz ${fault.platz} der Gruppe ${fault.gruppe} ist auch nach der Gruppenphase nicht zu entscheiden, daher bleibt Spiel ${fault.spiel_nr} offen`;
    case "spiel_missing":
      return `Spiel ${fault.spiel_nr} verweist auf Spiel ${fault.quelle_spiel_nr}, das es in dieser Saison nicht gibt`;
    case "reference_cycle":
      return `Spiel ${fault.spiel_nr} verweist über Spiel ${fault.quelle_spiel_nr} auf eine Verweiskette, die sich schließt — sie kann kein Ergebnis liefern`;
    case "same_team":
      return `In Spiel ${fault.spiel_nr} führen beide Seiten zur selben Mannschaft`;
  }
};
