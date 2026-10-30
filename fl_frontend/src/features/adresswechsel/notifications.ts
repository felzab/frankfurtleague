import "server-only";

import { ADRESSWECHSEL_WARTEZEIT_DAUER } from "@/core/adresswechsel";
import { formatInstant } from "@/core/format";

import type { FLAddressChangeVerwaltungMintResponse } from "@/core/generated/client/types";

/**
 * What the administrator is told of the change's mails, which the start owed and which leave behind its answer, naming
 * only the new address. Whether each arrived is the change's own read (`zustellung`).
 */
export function describeAdresswechselMail({ email, way: weg, valid_until: gueltigBis }: FLAddressChangeVerwaltungMintResponse): string {
  // With no link the notice to the address on file is the request itself.
  if (weg === "release") {
    return `Die bisherige Adresse wird gebeten, die Änderung in ihrem Konto freizugeben, bis ${formatInstant(gueltigBis)}. Erst danach geht der Link an die neue.`;
  }
  const wartezeit = weg === "waiting_period" ? ` Die neue gilt erst ${ADRESSWECHSEL_WARTEZEIT_DAUER} nach ihrer Bestätigung.` : "";

  return `Der Link zur Bestätigung der neuen Adresse geht an ${email}. Bis zur Bestätigung gilt die bisherige.${wartezeit}`;
}
