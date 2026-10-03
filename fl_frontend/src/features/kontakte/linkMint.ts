import type { FLSaisonTeamKontakte, FLSaisonTeamKontaktePayload } from "@/features/teams/schemas";

const SITZE = ["trainer", "ansprechperson", "stellvertretung"] as const;

/**
 * Whether a contacts save may mint a seat a link (`docs/frontend/spec.md :: I432`): a SUPERSET of
 * the backend's test, for `fl_frontend/src/features/schiedsrichter/linkMint.ts`'s reason. Raw
 * strings where the backend folds them: a case-only difference asks, harmlessly.
 */
export function kontakteMayMint(stored: FLSaisonTeamKontakte | null, sent: FLSaisonTeamKontaktePayload | null): boolean {
  // Clearing the block mints nothing; it is a step-up write of its own, judged where it is sent.
  if (sent === null) return false;

  return SITZE.some((rolle) => {
    const neu = sent[rolle];
    const alt = stored?.[rolle] ?? null;
    if (neu === null) return false;

    // The person is the seat's identity, and the telephone is not part of it.
    return alt === null || neu.email !== alt.email || neu.vorname !== alt.vorname || neu.nachname !== alt.nachname;
  });
}
