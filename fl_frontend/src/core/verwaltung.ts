import "server-only";

import { asSignInIdentifier } from "./emailAddress";
import { lookUpSubjekt } from "./signInGate";

import type { FLSubjektResponse } from "./schemas";

/** The grant an address holds, its tier and when it took effect, as the subject lookup serves both: null together for none. */
export type Verwaltung = Pick<FLSubjektResponse, "verwaltung" | "berechtigt_seit">;

const KEINE: Verwaltung = { verwaltung: null, berechtigt_seit: null };

/**
 * The grant an address holds, read per request and never stamped on a session, which a revoke made
 * in the database would outlive (`docs/frontend/spec.md :: I121`). Throws on every backend failure:
 * each reader decides what an unread grant means.
 */
export async function verwaltungOf(email: string): Promise<Verwaltung> {
  // Folded here because the library folds only CASE and only on the row it stores, while a grant is
  // stored folded (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`).
  const subjekt = await lookUpSubjekt(asSignInIdentifier(email));

  // A barred holder is no administrator, as the backend's actor check refuses them: a grant written in
  // the database directly is the one way onto a barred address, and it admits nothing.
  return subjekt.gesperrt ? KEINE : { verwaltung: subjekt.verwaltung, berechtigt_seit: subjekt.berechtigt_seit };
}
