import { KONTAKT_ROLLEN } from "@/features/teams/constants";

import type { PillTone } from "@/shared/components/ui/badges";
import type { FLBewerbungStatus } from "./schemas";

// Its own module and not an export of a `"use client"` view: every export of a client module becomes
// a client reference on the server side.
export const BEWERBUNGEN_CRUD_COPY = {
  searchLabel: "Bewerbungen suchen",
  searchPlaceholder: "z.B. Goethe-Gymnasium oder eine Ansprechperson",
  /** One per `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` value: each narrowing stage asks something different of the reader. */
  emptyForQuery: "Keine Bewerbungen für diese Suche.",
  emptyForFilters: "Keine Bewerbungen für diese Filter.",
  emptyOverall: "Es sind noch keine Bewerbungen eingegangen.",
} as const;

type BewerbungStatusOption = {
  readonly value: FLBewerbungStatus;
  /** Names the application's STATE, for a badge and for the triage's filter alike. */
  readonly label: string;
};

/**
 * The states an application stands in, in the order the triage works them down. Every wording lives
 * here as one fact, so no two surfaces can name one state differently.
 */
export const BEWERBUNG_STATUS_OPTIONS: readonly BewerbungStatusOption[] = [
  { value: "eingereicht", label: "Eingereicht" },
  { value: "angenommen", label: "Angenommen" },
  { value: "abgelehnt", label: "Abgelehnt" },
];

export function bewerbungStatusLabel(status: FLBewerbungStatus): string {
  return BEWERBUNG_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "";
}

/**
 * The tone each state wears, so the queue and the application's own page cannot read it two ways.
 * `abgelehnt` is `danger` and not `warning`: the league's Absage is final, and takes the grade a
 * seat's Widerspruch already wears.
 */
export const BEWERBUNG_STATUS_TINT: Record<FLBewerbungStatus, PillTone> = {
  eingereicht: "info",
  angenommen: "success",
  abgelehnt: "danger",
};

/** Which of the two things an application asks the league to enter: a school it does not hold yet, or a club it does. */
export type BewerbungHerkunft = "neue_schule" | "bestehendes_team";

/** What each is called, on the queue's badge, its filter and the application's own page alike. */
export const BEWERBUNG_HERKUNFT_LABELS: Record<BewerbungHerkunft, string> = {
  neue_schule: "Neue Schule",
  bestehendes_team: "Bestehendes Team",
};

/**
 * The decline reason's bound, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Every frontend
 * enforcement point reads it from here, so the schema and the input cannot disagree about the cap.
 */
export const BEWERBUNG_GRUND_MAX_LENGTH = 1000;

/**
 * A club's Kürzel is exactly this many characters, mirrored from
 * `fl_backend/app/shared/schemas/bounds.py`. Every site that counts a code reads it from here, the
 * application form and the club editor alike, so no two can disagree about a complete code.
 */
export const KUERZEL_LAENGE = 2;

/**
 * The submission's own ceilings, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Bound here too because
 * the public endpoint's `REQ-VAL-001` marks an over-long box with a generic sentence rather than the bound's German.
 */
export const BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH = 500;
export const BEWERBUNG_KADER_GROESSE_MAX = 200;
// `TEAM_FULL_NAME_MAX_LENGTH`'s width rather than the team name's: nothing holds an applicant to
// the league's short name, so what they type is a school's own name.
export const BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH = 120;

/**
 * How many pupils one Abi-Jahrgang holds, the ones who never play included, mirrored from
 * `fl_backend/app/shared/schemas/bounds.py`. A ceiling against a slipped digit rather than against a
 * real cohort: no school in the league fields an Abi-Jahrgang this size.
 */
export const BEWERBUNG_STUFENGROESSE_MAX = 999;

/**
 * The span a contact person's birthdate has to fall in, mirrored from
 * `fl_backend/app/shared/schemas/bounds.py` (`docs/backend/spec.md :: I180`). The ceiling refuses a
 * mistyped century rather than a real age, and no other date in an application gains a bound.
 */
export const BEWERBUNG_MIN_ALTER = 16;
export const BEWERBUNG_MAX_ALTER = 120;

/**
 * The floor the Ansprechperson and the Stellvertretung clear, mirrored from
 * `fl_backend/app/shared/schemas/bounds.py`. Those two sign what binds the school, which asks
 * contractual capacity rather than the age a person consents for themselves at.
 */
export const VERTRETUNG_MIN_ALTER = 18;

// Both bounds, never the floor alone: named for the floor, a mistyped year would answer a
// 190-year-old date with „mindestens 16“, which is a different fault.
export const alterAusserhalb = (mindestalter: number): string =>
  `Für Deine Bestätigung musst Du mindestens ${String(mindestalter)} und höchstens ${String(BEWERBUNG_MAX_ALTER)} Jahre alt sein. ` +
  `Prüfe das Geburtsdatum.`;

/**
 * The two clocks a confirmation link runs on, mirrored from `fl_backend/app/shared/schemas/bounds.py`
 * so the page states the deadline the sweep deletes on rather than a literal of its own.
 */
export const BEWERBUNG_BESTAETIGUNG_FRIST_TAGE = 14;
export const BEWERBUNG_ERINNERUNG_TAGE = 3;

/**
 * The raw token's ceiling, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Bound at the two
 * consent payloads because a link mangled longer than any mint answers a `REQ-VAL-001` naming the
 * token, which no control renders, so it tells a visitor nothing about their link.
 */
export const BEWERBUNG_TOKEN_MAX_LENGTH = 128;

/**
 * The picker key standing for „meine Schule ist nicht dabei“.
 *
 * **Not an ObjectId and never one**: every other key in that list is a club id, so a sentinel that
 * could be mistaken for one would submit as `team_id` and name a club nobody picked.
 */
export const SCHULE_NICHT_IN_LISTE = "neue-schule";

/** What that option reads as, in the trigger as well as in the list — one string, so the two agree. */
export const SCHULE_NICHT_IN_LISTE_LABEL = "Meine Schule steht nicht in der Liste";

/**
 * A re-send's answer for a seat holding no address, whether the action refuses the press or the strip closes the
 * control first: one sentence, naming the correction that stands beside the control on the strip.
 */
export const ERNEUT_OHNE_ADRESSE =
  "Zu dieser Rolle steht keine E-Mail-Adresse in der Bewerbung. Trage zuerst eine über „Adresse korrigieren“ ein.";

/**
 * `KONTAKT_ROLLEN` under its long wording, never a second table: two lists of one set drift, and the
 * triage panel reads one while this form reads the other.
 */
export const BEWERBUNG_SEATS = KONTAKT_ROLLEN.map(({ value, langform }) => ({ value: value, label: langform }));
