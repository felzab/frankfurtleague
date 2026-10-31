import z from "zod";

import { FLAddressChangeViewableDenied } from "@/core/generated/client/types";
import { NACH_ERNENNUNG_NEU_ANMELDEN } from "@/features/berechtigungen/constants";

/** The served reason as the approval sends it back, read again on the server: a browser may send any value. */
export const EinsehbarVerwehrtSchema = z.enum(FLAddressChangeViewableDenied);

/**
 * What a page says in place of its way into the address tool, true of the change wherever a page names it: under its
 * address on file, or as a change onto another address.
 */
export const EINSEHBAR_VERWEHRT: Readonly<Record<FLAddressChangeViewableDenied, string>> = {
  own: "Es ist die Änderung Deiner eigenen Adresse. Du findest sie auf Deiner Kontoseite.",
  // An owner signed in before their promotion holds no owner's power yet, and would read the bare rule as false.
  verwaltung: `Öffnen kann sie nur eine Inhaberin oder ein Inhaber der Verwaltung. ${NACH_ERNENNUNG_NEU_ANMELDEN}`,
};
