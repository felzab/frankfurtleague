/**
 * How one link mail ended. `zurueckgehalten` is a deployment that mails nothing filing it
 * (`fl_frontend/src/core/mail.ts :: MailWithheldError`), `gesperrt` the ban list keeping it from the
 * address (`:: MailBarredError`).
 */
export type LinkVersand = "gesendet" | "zurueckgehalten" | "gesperrt" | "fehlgeschlagen";

/**
 * What the administrator who sent a link is told of it. `abgelegt` was never sent and never failed
 * (`docs/frontend/spec.md :: I542`): a retry meets the same ban or the same deployment.
 */
export type VersandGrad = "gesendet" | "fehlgeschlagen" | "abgelegt";

const GRAD: Readonly<Record<LinkVersand, VersandGrad>> = {
  gesendet: "gesendet",
  fehlgeschlagen: "fehlgeschlagen",
  gesperrt: "abgelegt",
  zurueckgehalten: "abgelegt",
};

/** The one grading of a link mail, read by every surface reporting one (`docs/frontend/spec.md :: I725`). */
export function versandGrad(versand: LinkVersand): VersandGrad {
  return GRAD[versand];
}

/** Whether a write titled by its own outcome grades its toast a warning for the link it sent; `undefined` sent none. */
export function versandWarnt(versand: LinkVersand | undefined): boolean {
  return versand !== undefined && versandGrad(versand) !== "gesendet";
}

/** A failed link outranks one held back, so a write sending several reports the one its administrator must act on. */
const RANG: Readonly<Record<VersandGrad, number>> = { gesendet: 0, abgelegt: 1, fehlgeschlagen: 2 };

/** The worst-graded of several links one write sent, `undefined` where it sent none. */
export function schlechtesterVersand(versendet: readonly LinkVersand[]): LinkVersand | undefined {
  return versendet.reduce<LinkVersand | undefined>(
    (schlechtester, versand) =>
      schlechtester === undefined || RANG[versandGrad(versand)] > RANG[versandGrad(schlechtester)] ? versand : schlechtester,
    undefined,
  );
}
