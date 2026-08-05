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

import type { FLSpiel, FLSpielQuelle, FLSpielStatus, FLUnresolvableSlot } from "./schemas";

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

  if (quelle.type === "gruppe") {
    return quelle.platz === 1 ? `Gruppensieger ${quelle.gruppe}` : `${quelle.platz}. der Gruppe ${quelle.gruppe}`;
  }

  return `${quelle.ausgang === "sieger" ? "Sieger" : "Verlierer"} ${quelle.spiel_nr}.`;
};

/**
 * The success message for an admin match edit, naming any bracket fixtures the write also moved.
 *
 * `PATCH /spiele/{spiel_id}` resolves the season's bracket, so entering a result can fill a later
 * fixture's slot — and correcting one can empty a slot that should never have been filled (ADR-0042).
 * The wording is therefore **"aktualisiert" rather than "eingetragen"**: `advanced_to` reports what
 * changed, and an emptied fixture is in it exactly as a filled one is.
 *
 * **`Paarung`, not `Aufstellung`.** What changed is which teams meet; an Aufstellung is the starting
 * line-up, which this site also stores, so the wrong word would name the wrong thing.
 *
 * Saying nothing when the list is empty is the point of reporting at all: an admin who has just entered
 * a quarter-final result and sees no second sentence knows the semi-final did not move.
 */
export const formatSpielUpdateMessage = (advancedTo: readonly number[], unresolvableSlots: readonly FLUnresolvableSlot[] = []): string => {
  const sentences = ["Die Spieldaten wurden erfolgreich aktualisiert"];

  if (advancedTo.length > 0) {
    // Intl rather than a hand-rolled join: German puts "und" before the last item with no serial comma,
    // and the runtime already knows that.
    const spiele = new Intl.ListFormat("de-DE", { style: "long", type: "conjunction" }).format(advancedTo.map(String));

    sentences.push(
      advancedTo.length === 1
        ? `Die Paarung in Spiel ${spiele} wurde ebenfalls aktualisiert`
        : `Die Paarungen in den Spielen ${spiele} wurden ebenfalls aktualisiert`,
    );
  }

  // Each slot is named individually rather than counted. There is at most a handful, and "zwei
  // Bracket-Verweise sind offen" tells an admin nothing they can act on.
  sentences.push(...unresolvableSlots.map(formatUnresolvableSlot));

  return sentences.join(". ");
};

/**
 * Why one bracket slot could not be seeded from its group, in a sentence an admin can act on.
 *
 * Only the two states no further result can fix reach this (ADR-0043) — a group that is still being
 * played produces neither, because a placing that is not decided yet needs nobody's attention.
 */
const formatUnresolvableSlot = ({ spiel_nr, gruppe, platz, reason }: FLUnresolvableSlot): string =>
  reason === "gruppe_too_small"
    ? `Spiel ${spiel_nr} verweist auf Platz ${platz} der Gruppe ${gruppe} — so weit reicht diese Gruppe nicht`
    : `Platz ${platz} der Gruppe ${gruppe} ist auch nach der Gruppenphase nicht zu entscheiden, daher bleibt Spiel ${spiel_nr} offen`;
