import "server-only";

import { asSignInIdentifier } from "./emailAddress";
import { lookUpSubjekt } from "./signInGate";

import type { FLSubjektResponse } from "./schemas";

/** The grant an address holds, its tier and when the grant and its `owner` tier took effect, as the subject lookup serves them: null together for none. */
export type Verwaltung = Pick<FLSubjektResponse, "verwaltung" | "berechtigt_seit" | "inhaber_seit">;

const KEINE: Verwaltung = { verwaltung: null, berechtigt_seit: null, inhaber_seit: null };

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
  return subjekt.gesperrt
    ? KEINE
    : { verwaltung: subjekt.verwaltung, berechtigt_seit: subjekt.berechtigt_seit, inhaber_seit: subjekt.inhaber_seit };
}

/**
 * Whether a session made at `made` is no older than `seit`: a privilege holds for sessions made since it
 * alone (`docs/frontend/spec.md :: I470`), judged here because ending older sessions at the change misses
 * one written in the database.
 */
export function madeSince(made: Date | string, seit: string | null): boolean {
  const created = new Date(made).getTime();
  const at = seit === null ? Number.NaN : new Date(seit).getTime();

  // An unreadable instant on either side admits nobody, as `withinLifetime` reads an unreadable stamp.
  return Number.isFinite(created) && Number.isFinite(at) && created >= at;
}

/**
 * Whether a session the administrator's guard admitted holds an owner's power: the grant `owner`, and
 * the session made since that tier took effect, where the backend judges an owner's write
 * (`docs/frontend/spec.md :: I535`).
 */
export function holdsOwnersTier(made: Date | string, { verwaltung, inhaber_seit }: Verwaltung): boolean {
  return verwaltung === "owner" && madeSince(made, inhaber_seit);
}
