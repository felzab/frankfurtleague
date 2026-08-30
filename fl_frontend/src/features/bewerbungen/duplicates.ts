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
  team: "Schule doppelt",
  kuerzel: "Kürzel doppelt",
};

/** One tint for both, in the grade the app gives a row that wants an eye rather than a fault. */
export const BEWERBUNG_DUBLETTE_TINT = "bg-warning/15 text-warning-strong";

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

  // Compared the way the backend's own uniqueness would: a Kürzel is a two-letter code, and `gg`
  // against `GG` is one code typed twice rather than two codes.
  const kuerzel = bewerbung.schule === null ? "" : bewerbung.schule.shorthand.trim().toUpperCase();

  return kuerzel === "" ? null : { art: "kuerzel", key: `${bewerbung.saison_id} kuerzel ${kuerzel}` };
}

/**
 * Which open applications share a club or a Kürzel. **Shown, never refused**: uniqueness on an
 * unauthenticated form lets a stranger lock a school out by typing its name. `eingereicht` both
 * sides: a decided one has nothing left to decide.
 */
export function findBewerbungDubletten(bewerbungen: readonly Kandidat[]): ReadonlyMap<string, BewerbungDublette> {
  const nachSchluessel = new Map<string, { art: BewerbungDublette; ids: string[] }>();

  for (const bewerbung of bewerbungen) {
    if (bewerbung.status !== "eingereicht") continue;

    const schluessel = dublettenSchluessel(bewerbung);
    if (schluessel === null) continue;

    const gruppe = nachSchluessel.get(schluessel.key) ?? { art: schluessel.art, ids: [] };
    gruppe.ids.push(bewerbung.id);
    nachSchluessel.set(schluessel.key, gruppe);
  }

  const dubletten = new Map<string, BewerbungDublette>();

  // A key held by one application is no duplicate: every member of a group of two or more is marked,
  // because neither of them is the real one until somebody decides which.
  for (const gruppe of nachSchluessel.values()) {
    if (gruppe.ids.length < 2) continue;
    for (const id of gruppe.ids) dubletten.set(id, gruppe.art);
  }

  return dubletten;
}
