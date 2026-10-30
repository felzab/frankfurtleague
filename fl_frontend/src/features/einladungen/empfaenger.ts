import type { FLEinladungEmpfaenger, FLSaisonTeamKontakte } from "@/core/generated/client/types";

/**
 * The seat order a shared mailbox is NAMED for, and the one
 * `fl_backend/app/api/einladungen/services.py :: plan_einladung_versand` answers in. Never
 * `fl_frontend/src/features/teams/constants.ts :: KONTAKT_ROLLEN`, which reads Ansprechperson
 * first: two orders would label one person differently on the two presses.
 */
const SITZE = ["trainer", "ansprechperson", "stellvertretung"] as const;

/**
 * **An address whose own person has not confirmed it is one nobody has proven, and a link is a
 * bearer credential**; a person holding two seats reads one message, so a mailbox is answered once.
 */
export function bestaetigteEmpfaenger(kontakte: FLSaisonTeamKontakte | null): readonly FLEinladungEmpfaenger[] {
  if (kontakte === null) return [];

  const gefunden = new Map<string, FLEinladungEmpfaenger>();

  for (const rolle of SITZE) {
    const person = kontakte[rolle];
    const adresse = person === null ? "" : person.email.trim();
    if (person === null || adresse === "" || person.einwilligung.bestaetigt_am === null) continue;

    // One mailbox is one stored address, each the fold the API stores.
    if (!gefunden.has(adresse)) gefunden.set(adresse, { rolle: rolle, vorname: person.vorname, email: adresse });
  }

  return [...gefunden.values()];
}
