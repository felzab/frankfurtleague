import type { FLSchulform, FLTrainerZugleich, FLTrikotFarbe } from "@/features/teams/schemas";
import type { FLBewerbung, FLBewerbungKontaktpersonPayload, FLBewerbungSchulePayload, FLBewerbungStatus } from "./schemas";

/** A club as the triage needs to know it, so any read carrying the two fields answers. */
export type NamedTeam = { id: string; name: string };

/**
 * One row of the triage list: the application as stored, plus the club it names resolved for
 * display. `null` where it names neither a school nor a club — the row `REQ-BEWERBUNG-002` refuses.
 */
export type AdminBewerbungRow = FLBewerbung & {
  teamName: string | null;
  // Answered against the season the header names, so the facet reading it stays a pure function of a
  // row: `fl_frontend/src/shared/utils/facets.ts :: Facet` sees nothing but the item.
  inSelectedSaison: boolean;
};

type FLBewerbungenSortingOptions = "eingereicht_am" | "saison_id";

/**
 * What the triage list may narrow on. No `bewerbung_id`: `GET /bewerbungen/{bewerbung_id}` names one.
 *
 * Omission is meaningful: `apiClient` drops undefined params rather than serialising them, so an
 * absent `status` is every state rather than none.
 */
export type FLBewerbungenFilterParams = {
  saison_id?: string;
  status?: FLBewerbungStatus;

  limit?: number;
  sort_by?: FLBewerbungenSortingOptions;
  order?: "asc" | "desc";
};

/**
 * One contact person mid-entry. Every field is typed, so an unanswered one is the empty string and
 * the schema is what turns it into a field error rather than a type error.
 */
export type BewerbungKontaktpersonDraft = Omit<FLBewerbungKontaktpersonPayload, "einwilligung"> & {
  // `erteilt` starts `false`, which `z.literal(true)` refuses: an untouched box is a consent nobody
  // gave, and the payload type admits no other value.
  einwilligung: { text_version: string; erteilt: boolean };
};

/** The three seats mid-entry. All three are present: an application is what three reachable people submitted. */
export type BewerbungKontakteDraft = {
  trainer: BewerbungKontaktpersonDraft;
  ansprechperson: BewerbungKontaktpersonDraft;
  stellvertretung: BewerbungKontaktpersonDraft;
  trainer_ist_zugleich: FLTrainerZugleich | null;
};

/**
 * A new school mid-entry. `schulform` is widened to `null` so the picker can stand unanswered; the
 * payload admits no null, and the schema is what turns an unanswered one into a field error.
 */
export type BewerbungSchuleDraft = Omit<FLBewerbungSchulePayload, "schulform"> & { schulform: FLSchulform | null };

/**
 * The public form's whole draft. **`auswahl` is the whole of „welche Schule“**: one field holds a
 * club id or the sentinel, so the both-at-once shape `REQ-BEWERBUNG-005` refuses cannot be composed.
 * A widened null is a control nobody has answered.
 */
export type BewerbungFormDraft = {
  saison_id: string;
  auswahl: string | null;
  schule: BewerbungSchuleDraft;
  kontakte: BewerbungKontakteDraft;
  trikot: { vorhandener_satz: string; wunschfarbe: FLTrikotFarbe | null };
  kader: { voraussichtliche_groesse: number | null; gute_spieler: number | null };
  // A STRING mid-entry where the payload's is `string | null`: `""` is a box nobody filled in, and
  // `bewerbungPayload` is the one place that turns it into null. Normalising per keystroke would
  // eat a space as it was typed.
  wunschgegner: string;
};

/**
 * Which state the page renders. `unlesbar` is not `fensterZustand`'s: the read failed, and a page
 * that answered "abgelaufen" there would state a deadline it never learnt.
 */
export type FensterZustand = "laeuft" | "noch-nicht" | "geschlossen" | "vorbei" | "keine-frist";

/**
 * A blur-time verdict on a Kürzel, kept with the value it judged. **The value, not just the answer**:
 * a refusal about `GG` says nothing about the `GY` the box holds a keystroke later.
 */
export type KuerzelVerdikt = { shorthand: string; vergeben: boolean };
