import z from "zod";

import { FLAddressChangeViewableDenied } from "@/core/generated/client/types";
import { NACH_ERNENNUNG_NEU_ANMELDEN } from "@/features/berechtigungen/constants";

/**
 * Why the address tool refuses its reader a change, as every read linking one into it serves it: the reader's own
 * address (`eigene`), or a grant holder's without an owner's power (`verwaltung`).
 */
export type EinsehbarVerwehrt = FLAddressChangeViewableDenied;

/** The served reason as the approval sends it back, read again on the server: a browser may send any value. */
export const EinsehbarVerwehrtSchema = z.enum(FLAddressChangeViewableDenied);

/**
 * What a page says in place of its way into the address tool, true of the change wherever a page names it: under its
 * address on file, or as a change onto another address.
 */
export const EINSEHBAR_VERWEHRT: Readonly<Record<EinsehbarVerwehrt, string>> = {
  own: "Es ist die Änderung Deiner eigenen Adresse. Du findest sie auf Deiner Kontoseite.",
  // An owner signed in before their promotion holds no owner's power yet, and would read the bare rule as false.
  verwaltung: `Öffnen kann sie nur eine Inhaberin oder ein Inhaber der Verwaltung. ${NACH_ERNENNUNG_NEU_ANMELDEN}`,
};
