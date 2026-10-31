import type { FLSubjectSeat } from "@/core/generated/client/types.ts";
import type { SubjectSession } from "@/core/subject.ts";

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
export const NO_RECORDS: SubjectSession["subject"] = deepFrozen({
  seats: [],
  spieler: [],
  schiedsrichter: [],
  unconfirmed: false,
  barred: false,
  verwaltung: null,
  granted_since: null,
  inhaber_seit: null,
});

/**
 * What a suite's backend holds for one address. `account` is stated, never worked out from the lists:
 * which records count is the backend's rule, and a double deriving it hands each case its own copy's answer.
 */
export type LookupFixture = Partial<SubjectSession["subject"]> & { readonly account: boolean };

/**
 * The path the sign-in gate reads, its own beside the subject read every guard takes. Spelled rather than built by
 * `getIdentityGetSignInUrl`: a suite imports this module ahead of its own doubles, and the generated client
 * loaded here would bind the real transport and config before them. A renamed path answers the gate the subject's
 * shape, which no sign-in case passes.
 */
const GATE_ENDPOINT = "/identity/sign_in";

/** One table of fixtures answering the subject read and the gate alike, each in its read's shape. */
export function answerAt(endpoint: string, held: LookupFixture): Record<string, unknown> {
  const { account, ...subject } = held;
  if (!endpoint.endsWith(GATE_ENDPOINT)) return subject;

  return {
    unconfirmed: subject.unconfirmed ?? false,
    account: account,
    barred: subject.barred ?? false,
    verwaltung: subject.verwaltung ?? null,
  };
}

/** One contact seat on a running season, which grants a panel. */
export const SEAT: FLSubjectSeat = deepFrozen({
  saison_id: "2526",
  team_id: "6890a1b2c3d4e5f607250011",
  rolle: "ansprechperson",
  team_name: "Goethe-Gymnasium",
  saison_status: "active",
});

export const seat = (fields: Partial<FLSubjectSeat> = {}): FLSubjectSeat => ({ ...SEAT, ...fields });

/** A person holding what `records` names and nothing else, and the administrator's verdict where `admin` is set. */
export const person = (records: Partial<SubjectSession["subject"]> = {}, admin = false): SubjectSession => ({
  email: "pia@example.org",
  admin: admin,
  subject: { ...NO_RECORDS, ...records },
});
