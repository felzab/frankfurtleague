import { mailboxKey } from "@/core/emailAddress";

import type { FLSaisonTeamKontakte } from "@/features/teams/schemas";
import type { FLEinladungEmpfaenger } from "./schemas";

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

    const postfach = mailboxKey(adresse);

    // Keyed by mailbox and valued by the address as stored, so what is written to is the address the
    // seat holds rather than a key built from it.
    if (!gefunden.has(postfach)) gefunden.set(postfach, { rolle: rolle, vorname: person.vorname, email: adresse });
  }

  return [...gefunden.values()];
}
