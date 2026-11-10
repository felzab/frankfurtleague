import type { FLAufstellungEntry, FLAufstellungResponse } from "@/core/generated/client/types";

/** The line-up an editor's draft holds: the pupils it names, and those of them who start (`kit/Lineup.tsx :: LineupValue`). */
type Drafted = { readonly picked: ReadonlyArray<string>; readonly starters: ReadonlyArray<string> };

/** Past every shirt number, four digits at the most: a pupil with none stands after the numbered ones. */
const LAST = 10_000;

const rankOf = (nummer: string | null) => (nummer === null ? LAST : Number(nummer));

/**
 * The whole line-up a save writes, from what the editor changed over the line-up as it is stored now: an editor sends
 * only the half it changed, and the write takes the line-up whole. A line-up stored since the editor was read is the
 * write's to refuse on the version the editor sends, so merging onto it writes nothing over another's save. The
 * entries stand in shirt-number order, the order the editor shows them, which the public match page lists them in.
 */
export function entriesOf(stored: Pick<FLAufstellungResponse, "spieler" | "kader" | "named">, changes: Partial<Drafted>): FLAufstellungEntry[] {
  const picked = changes.picked ?? stored.spieler.map((entry) => entry.spieler_id);
  const starters = new Set(changes.starters ?? stored.spieler.filter((entry) => entry.starts).map((entry) => entry.spieler_id));
  const rank = new Map([...stored.kader, ...stored.named].map((spieler) => [spieler.spieler_id, rankOf(spieler.nummer)]));
  return [...picked]
    .sort((one, other) => (rank.get(one) ?? LAST) - (rank.get(other) ?? LAST))
    .map((spieler_id) => ({ spieler_id, starts: starters.has(spieler_id) }));
}
