/**
 * The two sentences the invite's presses report, in their own module rather than inside
 * `fl_frontend/src/features/einladungen/actions.ts`: every export of an `actions.ts` is a
 * `runAdminMutation` callback, and a sentence per count is what a case has to reach.
 */

/** The season with nothing to send: no team of it is admitted, so the press writes to nobody. */
export const KEINE_TEAMS = "Diese Saison hat noch kein Team aufgenommen.";

/**
 * What an administrator is told where the whole fan-out was withheld, which is every stack but
 * production: a refusal would offer a retry no repeat of it can reach.
 */
export const ZURUECKGEHALTEN = "Diese Umgebung sendet keine E-Mails. Die Nachricht wurde nur abgelegt.";

/**
 * What the whole press reports. **A sentence per count**: a season of one team is the ordinary
 * start of a season, and both figures spelled would read „1 von 1 Teams“ there
 * (`docs/frontend/spec.md :: 1.12`).
 */
export function versandSatz(gemailt: number, teams: number): string {
  if (teams === 0) return KEINE_TEAMS;
  // Zero is the answer a local stack always gives, every send being withheld outside production
  // (`docs/frontend/spec.md :: I228`), so the shortfall is spelled rather than folded into a word.
  if (teams === 1) return gemailt === 1 ? "Registrierungslink gesendet: an das Team." : "Registrierungslink nicht gesendet.";

  return `Registrierungslinks gesendet: ${String(gemailt)} von ${String(teams)} Teams.`;
}

/**
 * **No numeral stands before a plural noun**: „an 1 Adressen“ is what a count interpolated into one
 * sentence produces (`docs/frontend/spec.md :: 1.12`).
 */
export function adressenSatz(zugestellt: number, gesamt: number): string {
  if (zugestellt < gesamt) return `Der Link ist unterwegs: ${String(zugestellt)} von ${String(gesamt)}.`;

  return gesamt === 1 ? "Der Link ist unterwegs." : `Der Link ist an alle ${String(gesamt)} Adressen unterwegs.`;
}
