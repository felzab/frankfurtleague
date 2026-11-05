import "server-only";

import { ADDRESS_CHANGE_WAIT_SPAN } from "@/core/adresswechsel";

import type { FLAddressChangeAdminMintResponse } from "@/core/generated/client/types";

/**
 * What the administrator is told of the change's mails, which the start owed and which leave behind its answer, naming
 * only the new address. Whether each arrived is the change's own read (`delivery`).
 */
export function describeAdresswechselMail({ email, way: way }: FLAddressChangeAdminMintResponse): string {
  const wartezeit = way === "waiting_period" ? ` Die neue gilt erst ${ADDRESS_CHANGE_WAIT_SPAN} nach ihrer Bestätigung.` : "";

  return `Der Link zur Bestätigung der neuen Adresse geht an ${email}. Bis zur Bestätigung gilt die bisherige.${wartezeit}`;
}
