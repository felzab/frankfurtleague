import { asRefusal } from "@/core/errors";
import { byShirtNumber } from "@/features/spieler/constants";

// Types alone: the editor's client module reads this module's row key, and the builder is the server's.
import type { Fault, Faulted } from "@/core/action";
import type { ServedField } from "@/core/errors";
import type { FLAufstellungEntry, FLAufstellungResponse } from "@/core/generated/client/types";

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
 * the index back to the pupil, whose row the builder words as it words every fault, the refusal's other faults beside
 * it. Such a pupil left the squad since the page was read. Read by each fault's own kind, so a refusal naming another
 * fault first still marks its pupils. `undefined` for a refusal naming no such pupil, and for any other failure, which
 * the action words as it words every one.
 */
export function refusedRows(error: unknown, sent: readonly FLAufstellungEntry[]): Faulted | undefined {
  const refusal = asRefusal(error);
  if (refusal === null) return undefined;
  let rows = 0;
  const faults = refusal.refusedFields.map((refused): Fault | ServedField => {
    const [list, index] = refused.path;
    const entry = refused.kind === "spieler_not_in_kader" && list === "spieler" && typeof index === "number" ? sent[index] : undefined;
    if (entry?.spieler_id == null) return refused;
    rows += 1;
    return { box: `changes.${REFUSED_ROW}${entry.spieler_id}`, kind: "spieler_not_in_kader", ctx: refused.ctx };
  });
  return rows === 0 ? undefined : { ok: false, errorCode: refusal.serverErrorCode, faults };
}
