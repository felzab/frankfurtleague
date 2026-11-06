import type { FLBewerbung } from "@/core/generated/client/types";
import type { PillTone } from "@/shared/components/ui/badges";

/** What two open applications collide on: one club picked twice. */
export type BewerbungDublette = "team";

/** What the collision reads as in the queue. */
export const BEWERBUNG_DUBLETTE_LABEL: Record<BewerbungDublette, string> = {
  team: "Team doppelt",
};

/** The grade the app gives a row that wants an eye rather than a fault. */
export const BEWERBUNG_DUBLETTE_TINT: PillTone = "warning";

/** The fields the collision is decided on, so a stored application and a triage row both answer. */
type Kandidat = Pick<FLBewerbung, "id" | "saison_id" | "status" | "team_id">;

/**
 * What an application would collide with another one on, or `null` where it names no club.
 *
 * The season is part of the key: one club applying in two seasons is two applications, not a
 * duplicate a triage has to decide between.
 */
function duplicatesKey(bewerbung: Kandidat): { kind: BewerbungDublette; key: string } | null {
  return bewerbung.team_id === null ? null : { kind: "team", key: `${bewerbung.saison_id} team ${bewerbung.team_id}` };
}

// **Shown, never refused**: uniqueness on an unauthenticated form lets a stranger lock a school out
// by typing its name, so the queue marks a collision instead of the write refusing one.
/**
 * Which of the loaded applications collide, by id — the answer the server took over the whole queue,
 * applied to the rows this page holds.
 */
export function markBewerbungDubletten(
  bewerbungen: readonly Kandidat[],
  kollidierendeSchluessel: readonly string[],
): ReadonlyMap<string, BewerbungDublette> {
  // The server's list and never a grouping over `bewerbungen`: a pair the endpoint's cap parted has
  // one half here and the other nowhere, and a group of one marks neither
  // (`fl_backend/app/api/bewerbungen/services.py :: dubletten_schluessel_of`).
  const kollidiert = new Set(kollidierendeSchluessel);
  const dubletten = new Map<string, BewerbungDublette>();

  for (const bewerbung of bewerbungen) {
    // The ROW's own status and not the key's: two open applications collide on a club a third,
    // declined one also names, and marking that one asks for a decision already taken.
    if (bewerbung.status !== "submitted") continue;

    const schluessel = duplicatesKey(bewerbung);

    if (schluessel === null || !kollidiert.has(schluessel.key)) continue;

    dubletten.set(bewerbung.id, schluessel.kind);
  }

  return dubletten;
}
