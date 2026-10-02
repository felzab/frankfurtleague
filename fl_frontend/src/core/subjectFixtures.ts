import type { FLSubjektSitz } from "./schemas.ts";
import type { SubjectSession } from "./subject.ts";

/**
 * The records a mailbox holding nothing answers. Spread under every subject a suite builds, so a field
 * the lookup gains reaches each of them here rather than by hand at every literal.
 */
export const NO_RECORDS: SubjectSession["subjekt"] = {
  sitze: [],
  spieler: [],
  schiedsrichter: [],
  unbestaetigt: false,
  gesperrt: false,
  verwaltung: null,
  berechtigt_seit: null,
};

/** One contact seat on a running season, which grants a panel. */
export const SITZ: FLSubjektSitz = {
  saison_id: "2526",
  team_id: "6890a1b2c3d4e5f607250011",
  rolle: "ansprechperson",
  team_name: "Goethe-Gymnasium",
  saison_status: "active",
};

export const sitz = (fields: Partial<FLSubjektSitz> = {}): FLSubjektSitz => ({ ...SITZ, ...fields });

/** A person holding what `records` names and nothing else, and the administrator's verdict where `admin` is set. */
export const person = (records: Partial<SubjectSession["subjekt"]> = {}, admin = false): SubjectSession => ({
  email: "pia@example.org",
  admin: admin,
  subjekt: { ...NO_RECORDS, ...records },
});
