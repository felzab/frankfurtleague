import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { byShirtNumber } from "@/features/spieler/constants";

import type { ActionAnswer } from "@/core/action";
import type { FLAufstellungEntry, FLAufstellungResponse } from "@/core/generated/client/types";

/** The line-up an editor's draft holds: the pupils it names, and those of them who start. */
type Drafted = { readonly picked: ReadonlyArray<string>; readonly starters: ReadonlyArray<string> };

/**
 * The whole line-up a save writes, from what the editor changed over the line-up as it is stored now: an editor sends
 * only the half it changed, and the write takes the line-up whole. A line-up stored since the editor was read is the
 * write's to refuse on the version the editor sends, so merging onto it writes nothing over another's save. The
 * entries stand in shirt-number order, the order the editor shows them, and the stored entries naming nobody after
 * them as stored: no editor changes one, and the write keeps them only where they are sent.
 */
export function entriesOf(stored: Pick<FLAufstellungResponse, "spieler" | "kader" | "named">, changes: Partial<Drafted>): FLAufstellungEntry[] {
  const named = stored.spieler.flatMap(({ spieler_id, starts }) => (spieler_id === null ? [] : [{ spieler_id, starts }]));
  const picked = changes.picked ?? named.map((entry) => entry.spieler_id);
  const starters = new Set(changes.starters ?? named.filter((entry) => entry.starts).map((entry) => entry.spieler_id));
  const nummer = new Map([...stored.kader, ...stored.named].map((spieler) => [spieler.spieler_id, spieler.nummer]));
  return [
    ...[...picked]
      .map((spieler_id) => ({ spieler_id, nummer: nummer.get(spieler_id) ?? null }))
      .sort(byShirtNumber)
      .map(({ spieler_id }) => ({ spieler_id, starts: starters.has(spieler_id) })),
    ...stored.spieler.filter((entry) => entry.spieler_id === null),
  ];
}

/** The box a pupil's refusal stands on, by their id: the block's row. */
export const REFUSED_ROW = "picked.";

/**
 * A write refusing pupils it names by entry, as the block marks them, each on their own row: `spieler_not_in_kader`
 * names each entry by its index among those `sent`, an order the editor never showed, so the save that sent them reads
 * the index back to the pupil. Such a pupil left the squad since the page was read. `undefined` for any other failure,
 * which the action words as it words every one.
 */
export function refusedRows(error: unknown, sent: readonly FLAufstellungEntry[]): ActionAnswer<never> | undefined {
  if (!(error instanceof APIBadStatusError) || error.serverErrorCode !== "spieler_not_in_kader") return undefined;
  const rows = error.refusedFields.flatMap(({ path: [list, index] }) => {
    const entry = list === "spieler" && typeof index === "number" ? sent[index] : undefined;
    return entry?.spieler_id == null ? [] : [[`changes.${REFUSED_ROW}${entry.spieler_id}`, COPY.admin.spieler.deregistered] as const];
  });
  return rows.length === 0 ? undefined : { ok: false, errorCode: "spieler_not_in_kader", fieldErrors: Object.fromEntries(rows) };
}
