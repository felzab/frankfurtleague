/**
 * SPIELE · derivations
 *
 * Pure derivation over a Spiel — no I/O and no caching, which is why it stays out of
 * `queries.ts`. Parsing `ergebnis` lives here because `FLSpielSchema` declares its format: Spiel
 * domain knowledge, not something a `teams` view should re-implement.
 *
 * Invariants:
 * - `computeSpielStatus` lets cancellation override the date and excludes today from
 *   `ausstehend`, unlike the server (ADR-0058) — a filter selects, a label partitions.
 * - `computeErgebnisFor` answers "?" whenever uncertain — a two-way branch would render a
 *   confident loss for a team that did not play.
 * - It reads `ergebnis` alone: a shoot-out is "D" here, matching the league table — only the
 *   bracket takes a winner from it (ADR-0036).
 *
 * See:
 * - docs/glossary.md — spiel_status, for the two definitions and why they differ
 */

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
 * variance, not copy-paste (ADR-0005).
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
 * table counts it as a draw (ADR-0036), so a card that showed `4:3` where `2:2` belongs would state the
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
 * Answers "?" for anything it cannot read with certainty, which covers four distinct cases:
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
 * The label is DERIVED, never stored: `quelle` is a reference and carries no German (ADR-0034), so this
 * is the single place the bracket's vocabulary exists. `null` in means the slot has no source at all —
 * a group-phase fixture, or one an admin has taken manual charge of — and the caller falls through to
 * `PLACEHOLDER.slot`.
 *
 * **Every placing reads as an ordinal, first included** — "1. der Gruppe A", not "Gruppensieger A"
 * (decided 2026-08-07). One form for the whole set is what lets a reader compare two slots at a glance
 * on the Finalrunden review, and a special case for one placing is a second thing to recognise for no
 * information: the ordinal already says the team won the group.
 */
export const formatQuelle = (quelle: FLSpielQuelle | null): string | null => {
  if (quelle === null) return null;

  // A source mid-edit holds `NaN` where its number is unpicked, which is a `number` and type-checks,
  // so without this guard every consumer prints "Sieger NaN." while somebody chooses a feeder match.
  // `null` means nothing renderable yet.
  if (!Number.isInteger(quelle.type === "gruppe" ? quelle.platz : quelle.spiel_nr)) return null;

  if (quelle.type === "gruppe") {
    return `${quelle.platz}. der Gruppe ${quelle.gruppe}`;
  }

  return `${quelle.ausgang === "sieger" ? "Sieger" : "Verlierer"} ${quelle.spiel_nr}.`;
};

/**
 * Who maintains one side of a fixture — the three answers a slot's two fields add up to.
 *
 * A `quelle` and a team are independent and all four combinations are stored states (ADR-0034), but
 * only one question has three answers: **what fills this side from here on.** A source owns the slot
 * and the resolution writes it; with no source the slot is the admin's, occupied or not; and a side
 * that is the admin's AND empty is filled by nobody at all (ADR-0034).
 *
 * - `quelle` — a source names it, so the resolution maintains it.
 * - `manuell` — no source, a team standing in it. The admin's, and settled.
 * - `offen` — no source and no team. The one legal state that stays broken by default.
 *
 * **This is the single declaration of that reading**, which is why it is a function over two fields
 * rather than a branch at each call site: the triage list's `besetzung_missing` category and the
 * wiring review's per-slot badge are the same question asked twice, and a second spelling of `offen`
 * is how the two surfaces come to disagree about which fixtures need somebody.
 */
export type FLSlotHerkunft = "quelle" | "manuell" | "offen";

export const deriveSlotHerkunft = (team: FLSpielTeamField | null, quelle: FLSpielQuelle | null): FLSlotHerkunft =>
  quelle !== null ? "quelle" : team !== null ? "manuell" : "offen";

/**
 * Each round's place in the order they are played, so "strictly earlier" and "furthest reached" are
 * both comparisons.
 *
 * Mirrors `PHASE_RANK` in `fl_backend/app/api/spiele/schemas.py` and exists for the same rule: a
 * bracket slot is fed only by a knockout match of an earlier round (ADR-0038). The form derives its
 * legal options from this; the backend refuses anything outside them.
 *
 * **Derived from `SAISON_PHASE_OPTIONS` rather than written out**, exactly as the backend derives its
 * copy from `PHASE_ORDER`. A hand-written map is a second statement of the sequence, and adding a round
 * would then compile with that round ranked nowhere (ADR-0052).
 */
export const PHASE_RANK: Record<FLSaisonPhase, number> = Object.fromEntries(SAISON_PHASE_OPTIONS.map((phase, rank) => [phase, rank])) as Record<
  FLSaisonPhase,
  number
>;

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
 * check against its draft. The write-path refusal is the backend's half (ADR-0042); this
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
 * advanced from the standings is exactly what ADR-0035 keeps out of the client, so this reads only
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
 * fed from (ADR-0034), and therefore the recommendation the feeder picker marks. The picker's list
 * legitimately spans every earlier round; for a final that is quarter- AND semi-finals, and the
 * chip is what says which of them the bracket ordinarily means.
 */
export const isDirectlyPrecedingRound = (feeder: Pick<FLSpiel, "saison_phase">, target: Pick<FLSpiel, "saison_phase">): boolean =>
  PHASE_RANK[feeder.saison_phase] === PHASE_RANK[target.saison_phase] - 1;

/**
 * The matches a slot of `target` may legally be fed by: knockout matches of the same season in a
 * strictly earlier round, in bracket order (ADR-0038).
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
 * One side of a read fixture, narrowed to what the match document actually stores.
 *
 * A read serves the joined side, which carries the season's `disqualifikation` looked up per request
 * (ADR-0021 rule 4). Structural typing accepts that object wherever the stored shape is asked for, so
 * without this the join rides into the editor's draft and back onto the write path — where Zod's
 * `strip` mode is the only thing keeping it off the wire and Pydantic's `extra="ignore"` the only
 * thing keeping it out of the document.
 *
 * Every field is listed rather than omitted by key, so a field added to the join stays out by default.
 */
export const toStoredSide = (side: FLSpielTeamFieldJoined | null): FLSpielTeamField | null =>
  side === null ? null : { team_id: side.team_id, name: side.name, tore: side.tore, shorthand: side.shorthand };

/**
 * One stored fixture as the payload that would restore it.
 *
 * **What the undo toast is built from** (ADR-0041). A save that resolves the bracket can delete a
 * result somebody entered in a fixture the request never named, and nothing on the server keeps the
 * old value — no admin write is recorded anywhere. The page that was looking at the
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
 * The React key of the match editor's subtree: **the stored state a draft is seeded from.**
 *
 * The editor's fields are `useState` initialised from `spielData`, and an initialiser runs once per
 * mounted instance. React keeps that instance for as long as its `key` and position hold, so fresh
 * props alone never re-seed a field — which is why resetting is done with a key at all
 * (["you can reset state with a key"](https://react.dev/learn/preserving-and-resetting-state#resetting-state-with-a-key)).
 *
 * **The fixture id alone is not enough, and the gap is the undo.** Two different fixtures differ by
 * id, so `/admin/spiele/A → /admin/spiele/B` resets correctly. The *same* fixture whose stored values
 * changed does not: after an undo restores a fixture and the admin opens it again, the server sends
 * the restored data and the mounted editor keeps showing what it was seeded with, until a reload.
 *
 * Built from `toPatchPayload` rather than from the whole fixture, and that is the precise statement:
 * those are exactly the fields the draft mirrors, so the key changes when — and only when — something
 * the form is showing has changed underneath it. Fields no draft atom holds (`spiel_nr`, `ergebnis`,
 * `saison_phase`) cannot reset a form that never displayed them as editable state.
 *
 * The id is kept in front of the digest so the key stays readable in a React devtools tree, and so two
 * fixtures that happen to hold identical values still key apart.
 */
export const spielStateKey = (spiel: FLSpiel): string => `${spiel.id}:${JSON.stringify(toPatchPayload(spiel))}`;

/**
 * The requests that put a season back the way it was before one save (ADR-0041).
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
 * Where one fixture is edited (ADR-0040).
 *
 * One spelling of the route, because three surfaces need it — the match cards, the action-required list,
 * and any later triage view that deep-links into a single fixture. A path built at each site is how two
 * of them end up disagreeing after the segment is renamed.
 */
export const adminSpielEditHref = (spielId: string): string => `/admin/spiele/${spielId}`;

/**
 * The fixtures whose occupants this one's result decides — what tells the edit surface a dry-run
 * preview is worth requesting at all (ADR-0041).
 *
 * The inverse direction to `listFeederSpiele`, and over stored wiring rather than legal candidates: a
 * fixture is dependent when it actually names this one as a source, or when it seeds a placing from a
 * group this fixture is played in.
 *
 * **Both routes matter, and the group one is the route an admin meets first.** A knockout slot fed by
 * `{type: "spiel"}` is voided when the match it names changes hands; a slot fed by `{type: "gruppe"}` is
 * voided when the standings that decide the placing change, which is what a corrected group result does
 * (ADR-0035). `ausgang` is not compared, because either outcome of this fixture moves the slot.
 *
 * `gruppen` is the groups this fixture is played in, which a match document does not carry — `FLSpiel`
 * embeds its sides and a group lives on the `saison_teams` junction the team list already joins
 * (ADR-0021). Empty for a knockout fixture, where the group route cannot apply.
 *
 * **This states the wiring; it does not predict the loss.** Whether a save actually voids a stored
 * result is the dry run's answer (ADR-0041) — this list only decides whether a preview request is
 * worth issuing, so a dependent fixture listed here is one whose result *can* be affected, and the
 * dry run names the ones that actually are.
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
 * fixture's slot — and correcting one can empty a slot that should never have been filled (ADR-0034).
 * The wording is therefore **"aktualisiert" rather than "eingetragen"**: `advanced_to` reports what
 * changed, and an emptied fixture is in it exactly as a filled one is.
 *
 * **A destroyed result gets its own sentence** (ADR-0041). A moved `Paarung` and a deleted scoreline
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

  // A sentence of its own, and the whole point of the shape change (ADR-0041). A cleared result is a
  // different fact from a slot changing occupant, and one message about a `Paarung` tells an admin
  // nothing about the scoreline they just deleted.
  const voided = advancedTo.filter((advancement) => advancement.voided_ergebnis !== null);
  if (voided.length > 0) {
    sentences.push(
      voided.length === 1
        ? `Das eingetragene Ergebnis in Spiel ${joinSpiele(voided)} wurde dabei gelöscht`
        : `Die eingetragenen Ergebnisse in den Spielen ${joinSpiele(voided)} wurden dabei gelöscht`,
    );
  }

  // The other write this endpoint can make: a team fielded here leaves the fixture it played on the
  // same Spieltag (ADR-0042). Named per fixture rather than counted, because the admin has to know
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
 * Why one derived fault needs a person, in a sentence an admin can act on (ADR-0039).
 *
 * Six reasons, and every one of them names the fixture to open and what is wrong inside it. Only states
 * no further result can fix reach here — a group that is still being played produces none of them,
 * because a placing that is not decided yet needs nobody's attention (ADR-0035).
 *
 * These serve the save's TOAST, which arrives with no fixture in sight — so every sentence names its
 * match number. The triage list's per-card notes use `describeBracketFaultOnCard` below, which says the
 * same thing without restating the number the card already leads with.
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
    // The one fault that is not about the bracket, so its sentence names both dates rather than a
    // reference: what makes it a fault is their order, and the fixture's own date may be missing.
    case "disqualified_occupant":
      return fault.spiel_datum === null
        ? `In Spiel ${fault.spiel_nr} steht ${fault.team_name}, disqualifiziert seit ${formatSpielDatum(fault.disqualifiziert_seit)}. Das Spiel hat kein Datum, also ist nicht belegt, dass es vorher stattfand`
        : `Spiel ${fault.spiel_nr} am ${formatSpielDatum(fault.spiel_datum)} führt ${fault.team_name}, disqualifiziert seit ${formatSpielDatum(fault.disqualifiziert_seit)}`;
  }
};

/**
 * The same fault, worded for a note that sits directly beside the fixture it names (decided 2026-08-08).
 *
 * `formatBracketFault` opens every sentence with "Spiel N", because a toast arrives with no fixture in
 * sight. A note attached to the card would repeat the number the card itself leads with — so these speak
 * about "dieses Spiel" directly, in plainer German, and name only what the card does not already show.
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
 * Every fault's card wording, filed under the fixture it names, so each note states its own reasons.
 *
 * **Keyed on `spiel_id` and never on `spiel_nr`**, which the action-required route repeats: that route
 * spans seasons, and two seasons both have a match 29. `FLSpieleActionRequiredResponseSchema` states the
 * same rule, and it is the only join between the two arrays it returns.
 *
 * **One fixture can carry several**, which is why the value is a list rather than a sentence: two broken
 * sides, or a cycle beside a group reference, are corrected separately and so are reported separately.
 * Insertion order is the backend's, which reports the faults of one fixture together.
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
