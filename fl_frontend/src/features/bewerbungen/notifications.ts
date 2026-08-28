import "server-only";

import { logger } from "@/core/logging";
import { sendMail } from "@/core/mail";

import type { BewerbungEmail } from "@/core/bewerbungEmail";
import type { FLKontaktperson } from "@/features/teams/schemas";

/**
 * The three seats as the API serves them. Wider than `FLSaisonTeamKontakte` in the one way that
 * matters here: an erasure empties the slot naming one person without reaching the two beside them.
 */
export type BewerbungSeats = {
  trainer: FLKontaktperson | null;
  ansprechperson: FLKontaktperson | null;
  stellvertretung: FLKontaktperson | null;
};

/** What one fan-out reached and what it did not, in the order the addresses were tried. */
export type BewerbungMailOutcome = {
  delivered: readonly string[];
  unreachable: readonly string[];
};

/**
 * Both feminine, which every `die ${betreff}` in this module and in
 * `fl_frontend/src/features/bewerbungen/actions.ts :: notifyBewerbung` assumes: a third noun would
 * have to bring its own article (`docs/frontend/spec.md` §1.12).
 */
export type BewerbungBetreff = "Zusage" | "Absage";

/**
 * **Distinct, because one person can hold two seats**: with `trainer_ist_ansprechperson` the same
 * record is stored twice. Two are one mailbox when their local parts match byte for byte under a
 * domain compared without case (RFC 5321 §2.4).
 */
export function collectBewerbungEmpfaenger(kontakte: BewerbungSeats): string[] {
  // Stricter than `fl_backend/app/api/kontakte/services.py :: _same_address`, which folds the whole
  // address, on purpose: over-matching leaves an erasure nothing behind and costs a fan-out a person.
  const addresses = new Map<string, string>();

  // The three seats are read here and nowhere else, so no caller can notify two of them.
  for (const seat of [kontakte.trainer, kontakte.ansprechperson, kontakte.stellvertretung]) {
    const address = seat === null ? "" : seat.email.trim();
    if (address === "") continue;

    const at = address.lastIndexOf("@");
    const mailbox = at === -1 ? address : `${address.slice(0, at)}@${address.slice(at + 1).toLowerCase()}`;

    // Keyed by mailbox and valued by the address as stored, so what is sent to is what was typed.
    if (!addresses.has(mailbox)) addresses.set(mailbox, address);
  }

  return [...addresses.values()];
}

/**
 * One message to every address, **settling all of them**: the decision it reports is committed and
 * cannot be undone, so one refused recipient must not cost the others their notification.
 */
export async function sendBewerbungMail({
  operation,
  recipients,
  mail,
}: {
  /** The action this fan-out belongs to: `sendMail`'s own line cannot say which decision failed. */
  operation: string;
  recipients: readonly string[];
  mail: BewerbungEmail;
}): Promise<BewerbungMailOutcome> {
  const settled = await Promise.allSettled(
    recipients.map((to) => sendMail({ to: to, subject: mail.subject, html: mail.html, text: mail.text })),
  );

  const delivered: string[] = [];
  const unreachable: string[] = [];

  settled.forEach((result, index) => {
    // One array mapped, so the index is the address; `forEach` walks only indices that exist.
    const address = recipients[index]!;

    if (result.status === "fulfilled") {
      delivered.push(address);
      return;
    }

    unreachable.push(address);
    // Name only, never the error: `fl_frontend/src/core/logFormat.ts :: serializeError` writes a
    // message and a stack, and the address stays off the stream (`docs/logging/spec.md :: L9`).
    logger.error("bewerbung.mail_failed", undefined, {
      name: result.reason instanceof Error ? result.reason.name : undefined,
      error_code: "FE-MAIL-002",
      operation: operation,
    });
  });

  return { delivered: delivered, unreachable: unreachable };
}

/**
 * What the fan-out did, as the sentence the action appends to its report.
 *
 * `betreff` is the bare noun, each arm supplying its own article: „die Zusage“ mid-sentence and
 * „Die Zusage“ at the start are one noun in two positions, not two strings.
 */
export function describeBewerbungMail(betreff: BewerbungBetreff, { delivered, unreachable }: BewerbungMailOutcome): string {
  if (delivered.length === 0 && unreachable.length === 0) {
    return `Die Bewerbung nennt keine E-Mail-Adresse, deshalb ging die ${betreff} an niemanden raus.`;
  }

  // German counts nothing and one with words, never with a figure.
  if (unreachable.length === 0) {
    return delivered.length === 1
      ? `Die ${betreff} ging an eine Kontaktperson.`
      : `Die ${betreff} ging an ${String(delivered.length)} Kontaktpersonen.`;
  }

  const nichtErreicht = `Nicht erreicht wurden: ${unreachable.join(", ")}. Melde Dich selbst bei ihnen.`;

  return delivered.length === 0
    ? `Die ${betreff} konnte niemandem zugestellt werden. ${nichtErreicht}`
    : `Die ${betreff} ging raus. ${nichtErreicht}`;
}
