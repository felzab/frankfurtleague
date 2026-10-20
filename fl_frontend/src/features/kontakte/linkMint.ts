import { KONTAKT_ROLLEN } from "@/features/teams/constants";

import type { FLSaisonTeamKontakte, FLSaisonTeamKontaktePayload } from "@/features/teams/schemas";

/** The three seats, off the one list every seat control renders. */
const SITZE = KONTAKT_ROLLEN.map(({ value }) => value);

/**
 * Whether a contacts save may mint or void a seat's link, a step-up write either way
 * (`docs/frontend/spec.md :: I432`): a SUPERSET of the backend's test, for
 * `fl_frontend/src/features/schiedsrichter/linkMint.ts`'s reason. Raw strings where the backend folds them.
 */
export function kontakteMayMoveLinks(stored: FLSaisonTeamKontakte | null, sent: FLSaisonTeamKontaktePayload | null): boolean {
  // Clearing the block is a step-up write of its own, judged where it is sent.
  if (sent === null) return false;

  return SITZE.some((rolle) => {
    const neu = sent[rolle];
    const alt = stored?.[rolle] ?? null;
    // Filling a seat mints, and emptying one voids its links on the team's match confirmations that season, answered and
    // closed ones too, a confirmed seat's included (`fl_backend/app/api/teams/services.py :: voids_a_live_link`).
    if (alt === null) return neu !== null;
    if (neu === null) return true;

    // The person is the seat's identity, and the telephone is not part of it.
    return neu.email !== alt.email || neu.vorname !== alt.vorname || neu.nachname !== alt.nachname;
  });
}
