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

    // Folding the whole address would merge two people whose mailboxes differ only in case, and
    // cost one of them the message. The comparison is the endpoint's and
    // `fl_frontend/src/features/bewerbungen/notifications.ts :: collectSeats`'s.
    const at = adresse.lastIndexOf("@");
    const postfach = at === -1 ? adresse : `${adresse.slice(0, at)}@${adresse.slice(at + 1).toLowerCase()}`;

    // Keyed by mailbox and valued by the address as stored, so what is written to is what was typed.
    if (!gefunden.has(postfach)) gefunden.set(postfach, { rolle: rolle, vorname: person.vorname, email: adresse });
  }

  return [...gefunden.values()];
}
