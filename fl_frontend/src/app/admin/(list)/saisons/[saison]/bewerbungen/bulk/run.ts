import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { FLBewerbungGruppeOffer, FLBewerbungListRow } from "@/core/generated/client/types";

/** What a card's boxes hold once „Weiter“ took them. */
export type Draft = { gruppe: string; trikot_farbe: string; shorthand: string };

/** How one application's write ended: entered, or turned away with what its row and its card say. */
export type Outcome =
  { kind: "accepted" } | { kind: "refused"; taken: boolean; line: Copy | undefined; fieldErrors: Readonly<Record<string, Copy>> | undefined };

/** Where a run stands: the choices made, the applications left out of it and each write's end, by application. */
export type Run = {
  drafts: Readonly<Record<string, Draft>>;
  skipped: ReadonlySet<string>;
  outcomes: Readonly<Record<string, Outcome>>;
};

/** The applications the run still has to enter, in their order: every one but those skipped or entered. */
export const openRows = (rows: readonly FLBewerbungListRow[], { skipped, outcomes }: Run): readonly FLBewerbungListRow[] =>
  rows.filter((row) => !skipped.has(row.id) && outcomes[row.id]?.kind !== "accepted");

/**
 * Which card a run stands at: the one the address names unless it is entered, else the first still to be chosen, else
 * none, and the run stands at its check page. A row sent back from there opens its card by name, and Back a card by
 * its address, a skipped one included.
 */
export function cardOf(rows: readonly FLBewerbungListRow[], run: Run, named: string | null): FLBewerbungListRow | null {
  return (
    rows.find((row) => row.id === named && run.outcomes[row.id]?.kind !== "accepted") ??
    openRows(rows, run).find((row) => run.drafts[row.id] === undefined) ??
    null
  );
}

/**
 * The groups as a card may offer them: each place the run's other open applications already chose is one less, so no
 * card fills a group past what the season still holds, which the write would refuse row by row.
 */
export function gruppenFor(
  gruppen: readonly FLBewerbungGruppeOffer[],
  rows: readonly FLBewerbungListRow[],
  run: Run,
  own: string,
): readonly FLBewerbungGruppeOffer[] {
  const others = openRows(rows, run).filter((row) => row.id !== own);
  return gruppen.map(({ gruppe, free }) => ({
    gruppe,
    free: free - others.filter((row) => run.drafts[row.id]?.gruppe === gruppe).length,
  }));
}

/** The colours a card may not take: the season's, and each the run's other open applications chose, as `gruppenFor` counts a group. */
export function takenFor(taken: readonly string[], rows: readonly FLBewerbungListRow[], run: Run, own: string): readonly string[] {
  const picks = openRows(rows, run)
    .filter((row) => row.id !== own)
    .flatMap((row) => run.drafts[row.id]?.trikot_farbe || []);
  return [...taken, ...picks];
}

/** One write's answer as its row keeps it. A code another club took is the one refusal its row names by a chip. */
export function outcomeOf(answer: ActionAnswer): Outcome {
  if (answer.ok) return { kind: "accepted" };
  const { errorCode, reason, fieldErrors } = answer;
  return { kind: "refused", taken: errorCode === "duplicate_key", line: reason, fieldErrors };
}
