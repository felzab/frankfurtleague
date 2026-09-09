import type { PillTone } from "@/shared/components/ui/badges";
import type { FLBewerbung } from "./schemas";

/**
 * What two open applications collide on. Never both at once: an application names either a club or a
 * proposed school, the shape `REQ-BEWERBUNG-005` refuses, so each row carries exactly one key.
 */
export type BewerbungDublette = "team" | "kuerzel";

/**
 * What each collision reads as in the queue.
 *
 * Two wordings and not one: the same club applying twice is one school's doing, while two schools
 * proposing one Kürzel is a clash between strangers, and an administrator acts on them differently.
 */
export const BEWERBUNG_DUBLETTE_LABEL: Record<BewerbungDublette, string> = {
  team: "Team doppelt",
  kuerzel: "Kürzel doppelt",
};

/** One tone for both, the grade the app gives a row that wants an eye rather than a fault. */
export const BEWERBUNG_DUBLETTE_TINT: PillTone = "warning";

/** The fields the collision is decided on, so a stored application and a triage row both answer. */
type Kandidat = Pick<FLBewerbung, "id" | "saison_id" | "status" | "team_id" | "schule">;

/**
 * What an application would collide with another one on, or `null` where it names neither.
 *
 * The season is part of the key: one club applying in two seasons is two applications, not a
 * duplicate a triage has to decide between.
 */
function dublettenSchluessel(bewerbung: Kandidat): { art: BewerbungDublette; key: string } | null {
  if (bewerbung.team_id !== null) return { art: "team", key: `${bewerbung.saison_id} team ${bewerbung.team_id}` };

  // Folded, which `uniq_shorthand` is not: that index compares two-letter codes byte for byte, so
  // `gg` beside `GG` would enter the league as two clubs, and the queue asks about it first.
  const kuerzel = bewerbung.schule === null ? "" : bewerbung.schule.shorthand.trim().toUpperCase();

  return kuerzel === "" ? null : { art: "kuerzel", key: `${bewerbung.saison_id} kuerzel ${kuerzel}` };
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
    // The ROW's own status and not the key's: two open applications collide on a Kürzel a third,
    // declined one also carries, and marking that one asks for a decision already taken.
    if (bewerbung.status !== "eingereicht") continue;

    const schluessel = dublettenSchluessel(bewerbung);

    if (schluessel === null || !kollidiert.has(schluessel.key)) continue;

    dubletten.set(bewerbung.id, schluessel.art);
  }

  return dubletten;
}
