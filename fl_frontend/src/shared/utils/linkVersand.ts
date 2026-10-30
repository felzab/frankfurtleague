/**
 * How one link mail ended. `zurueckgehalten` is a deployment that mails nothing filing it
 * (`fl_frontend/src/core/mail.ts :: MailWithheldError`), `gesperrt` the ban list keeping it from the
 * address (`:: MailBarredError`).
 */
export type LinkVersand = "gesendet" | "zurueckgehalten" | "gesperrt" | "fehlgeschlagen";

/**
 * What the administrator who sent a link is told of it. `abgelegt` was never sent and never failed:
 * a retry meets the same ban or the same deployment.
 */
export type VersandGrad = "gesendet" | "fehlgeschlagen" | "abgelegt";

const GRAD: Readonly<Record<LinkVersand, VersandGrad>> = {
  gesendet: "gesendet",
  fehlgeschlagen: "fehlgeschlagen",
  gesperrt: "abgelegt",
  zurueckgehalten: "abgelegt",
};

/** The one grading of a link mail, read by every surface reporting one. */
export function versandGrad(versand: LinkVersand): VersandGrad {
  return GRAD[versand];
}

/** Whether a write titled by its own outcome grades its toast a warning for the link it sent; `undefined` sent none. */
export function versandWarnt(versand: LinkVersand | undefined): boolean {
  return versand !== undefined && versandGrad(versand) !== "gesendet";
}

/**
 * How an address change's notice to the stored address ended: a link mail's ends, or `ungewiss`, a send broken off
 * unanswered that may have landed. A courtesy beside a saved write, it words its own doubt.
 */
export type HinweisVersand = LinkVersand | "ungewiss";

/**
 * Whether an address change's notice to the stored address failed or may have, which its sentence asks the
 * administrator to make good by hand: one held back, or none stored, asks nothing.
 */
export function hinweisFehlt(hinweis: HinweisVersand | null | undefined): boolean {
  if (hinweis === "ungewiss") return true;

  return hinweis !== null && hinweis !== undefined && versandGrad(hinweis) === "fehlgeschlagen";
}
