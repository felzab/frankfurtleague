import type { FLSubjektSitz } from "./schemas.ts";
import type { SubjectSession } from "./subject.ts";

/**
 * `value` with every object and array under it frozen. Every subject a suite builds shares these, so
 * a write into one throws at the case that made it rather than changing what a later case is handed.
 */
export function deepFrozen<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    for (const inner of Object.values(value)) deepFrozen(inner);
    Object.freeze(value);
  }

  return value;
}

/**
 * The records a mailbox holding nothing answers. Spread under every subject a suite builds, so a field
 * the lookup gains reaches each of them here rather than by hand at every literal.
 */
export const NO_RECORDS: SubjectSession["subjekt"] = deepFrozen({
  sitze: [],
  spieler: [],
  schiedsrichter: [],
  unbestaetigt: false,
  gesperrt: false,
  verwaltung: null,
  berechtigt_seit: null,
  inhaber_seit: null,
});

/**
 * What a suite's backend holds for one address: the subject's records, and `konto` as the gate answers
 * it. Stated by every fixture and never worked out from the lists: which records count is the backend's
 * rule, and a double deriving it hands each case the answer its own copy of that rule gives.
 */
export type LookupFixture = Partial<SubjectSession["subjekt"]> & { readonly acknowledged?: 0 | 1; readonly konto: boolean };

/** The path the sign-in gate reads, its own beside the subject read every guard takes. */
export const GATE_ENDPOINT = "/identitaet/anmeldung";

/** One table of fixtures answering the subject read and the gate alike, each in its read's shape. */
export function answerAt(endpoint: string, held: LookupFixture): Record<string, unknown> {
  const { konto, ...subjekt } = held;
  if (!endpoint.endsWith(GATE_ENDPOINT)) return subjekt;

  return {
    acknowledged: 1,
    unbestaetigt: subjekt.unbestaetigt ?? false,
    konto: konto,
    gesperrt: subjekt.gesperrt ?? false,
    verwaltung: subjekt.verwaltung ?? null,
  };
}

/** One contact seat on a running season, which grants a panel. */
export const SITZ: FLSubjektSitz = deepFrozen({
  saison_id: "2526",
  team_id: "6890a1b2c3d4e5f607250011",
  rolle: "ansprechperson",
  team_name: "Goethe-Gymnasium",
  saison_status: "active",
});

export const sitz = (fields: Partial<FLSubjektSitz> = {}): FLSubjektSitz => ({ ...SITZ, ...fields });

/** A person holding what `records` names and nothing else, and the administrator's verdict where `admin` is set. */
export const person = (records: Partial<SubjectSession["subjekt"]> = {}, admin = false): SubjectSession => ({
  email: "pia@example.org",
  admin: admin,
  subjekt: { ...NO_RECORDS, ...records },
});
