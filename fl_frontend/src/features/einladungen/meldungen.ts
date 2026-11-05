/**
 * The sentence the invite's single press reports, in its own module rather than inside
 * `fl_frontend/src/features/einladungen/actions.ts`: every export of an `actions.ts` is a
 * `runAdminMutation` callback, and a sentence per count is what a case has to reach.
 */

/**
 * **No numeral stands before a plural noun**: „an 1 Adressen“ is what a count interpolated into one
 * sentence produces.
 */
export function adressenSatz(zugestellt: number, gesamt: number): string {
  if (zugestellt < gesamt) return `Der Link ist unterwegs: ${String(zugestellt)} von ${String(gesamt)}.`;

  return gesamt === 1 ? "Der Link ist unterwegs." : `Der Link ist an alle ${String(gesamt)} Adressen unterwegs.`;
}
