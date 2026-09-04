import "server-only";

import { joinUnd } from "@/core/bewerbungEmail";
import { logger } from "@/core/logging";
import { sendMail } from "@/core/mail";

import { BEWERBUNG_SEATS } from "./constants";

import type { BewerbungEmail, BewerbungLinkSeat } from "@/core/bewerbungEmail";

/**
 * The three seats, narrowed to the one field a fan-out reads. Both a stored block and a submitted
 * payload satisfy it, and neither hands this module a person it has no reason to hold.
 */
export type BewerbungSeats = {
  trainer: { email: string } | null;
  ansprechperson: { email: string } | null;
  stellvertretung: { email: string } | null;
};

/** A seat by its stored key. Read off the block above, so a fourth seat reaches the fan-out with the type. */
type BewerbungRolle = keyof BewerbungSeats;

/**
 * One mailbox and the seats it holds, already one German phrase. **Per recipient**: two of the three
 * are told a different seat than the first, and one person holding two is told both.
 */
export type BewerbungEmpfaenger = { address: string; rollenText: string };

/** Both lists are in the order the addresses were tried. */
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

/** What one seat is called, in the wording the form asked for it under. */
function rolleLabel(rolle: BewerbungRolle): string {
  return BEWERBUNG_SEATS.find((seat) => seat.value === rolle)?.label ?? "";
}

/**
 * **Distinct, because one person can hold two seats**: where `trainer_ist_zugleich` names one, the
 * same record is stored twice. Two are one mailbox when their local parts match byte for byte under
 * a domain compared without case (RFC 5321 §2.4).
 */
function collectSeats(kontakte: BewerbungSeats): { address: string; rollen: BewerbungRolle[] }[] {
  // Stricter than `fl_backend/app/api/kontakte/services.py :: _same_address`, which folds the whole
  // address, on purpose: over-matching leaves an erasure nothing behind and costs a fan-out a person.
  const mailboxes = new Map<string, { address: string; rollen: BewerbungRolle[] }>();

  // The three seats are read here and nowhere else, so no caller can notify two of them. In the
  // order the form asks for them, which is the order a reader holding two is told them in.
  for (const seat of BEWERBUNG_SEATS) {
    const person = kontakte[seat.value];
    const address = person === null ? "" : person.email.trim();
    if (address === "") continue;

    const at = address.lastIndexOf("@");
    const mailbox = at === -1 ? address : `${address.slice(0, at)}@${address.slice(at + 1).toLowerCase()}`;

    // Keyed by mailbox and valued by the address as stored, so what is sent to is what was typed. A
    // second seat on a known mailbox ADDS its role rather than opening a second message.
    const known = mailboxes.get(mailbox) ?? { address: address, rollen: [] };
    known.rollen.push(seat.value);
    mailboxes.set(mailbox, known);
  }

  return [...mailboxes.values()];
}

function toEmpfaenger({ address, rollen }: { address: string; rollen: readonly BewerbungRolle[] }): BewerbungEmpfaenger {
  return { address: address, rollenText: joinUnd(rollen.map(rolleLabel)) };
}

/** Every distinct address the application names — who a decision the league has taken goes to. */
export function collectBewerbungEmpfaenger(kontakte: BewerbungSeats): BewerbungEmpfaenger[] {
  return collectSeats(kontakte).map(toEmpfaenger);
}

/**
 * The Ansprechperson's mailbox alone, and every seat it holds. **Every message addressed to the
 * submitter goes here**: no seat records who submitted, and the Ansprechperson is the submitter by
 * convention. Confirming an address is the link's job, not this fan-out's.
 */
export function collectBewerbungEingangEmpfaenger(kontakte: BewerbungSeats): BewerbungEmpfaenger[] {
  // Collected over all three seats and narrowed afterwards, never read off the one seat: a person
  // who is Ansprechperson AND Trainer is told both, in the one message their address gets.
  return collectSeats(kontakte)
    .filter((mailbox) => mailbox.rollen.includes("ansprechperson"))
    .map(toEmpfaenger);
}

/**
 * The three seats with the first name a confirmation message states beside a link. Assignable to
 * `BewerbungSeats`, so the dedupe reads one block whichever fan-out asked for it.
 */
export type BewerbungLinkSeats = {
  trainer: { email: string; vorname: string } | null;
  ansprechperson: { email: string; vorname: string } | null;
  stellvertretung: { email: string; vorname: string } | null;
};

/** One mailbox and every link it is sent, which is one message's worth. */
export type BewerbungLinkEmpfaenger = { address: string; seats: readonly BewerbungLinkSeat[] };

/**
 * One message per mailbox, carrying one link for each seat that mailbox holds. Two people on a
 * school inbox are two entries under one address.
 */
export function seatsByMailbox(
  kontakte: BewerbungLinkSeats,
  /** A seat the caller left out gets no link, and a mailbox left with none gets no message: that is what keeps a reminder off an answered seat. */
  linkBySeat: Partial<Record<BewerbungRolle, string>>,
): BewerbungLinkEmpfaenger[] {
  const gruppiert = collectSeats(kontakte).map(({ address, rollen }) => {
    // Keyed by link rather than by person: one token answering two seats is what the message has to
    // offer once, and nothing else here can tell those two seats are the same reader.
    const proLink = new Map<string, { vorname: string; rollen: BewerbungRolle[] }>();

    for (const rolle of rollen) {
      const seatLink = linkBySeat[rolle];
      if (seatLink === undefined || seatLink === "") continue;

      const bekannt = proLink.get(seatLink) ?? { vorname: kontakte[rolle]?.vorname ?? "", rollen: [] };
      bekannt.rollen.push(rolle);
      proLink.set(seatLink, bekannt);
    }

    const seats = [...proLink].map(([seatLink, { vorname, rollen: gehalten }]) => ({
      vorname: vorname,
      rolleText: joinUnd(gehalten.map(rolleLabel)),
      link: seatLink,
    }));

    return { address: address, seats: seats };
  });

  return gruppiert.filter(({ seats }) => seats.length > 0);
}

/**
 * One message to every address, **settling all of them**: the decision it reports is committed and
 * cannot be undone, so one refused recipient must not cost the others their notification.
 */
export async function sendBewerbungMail({
  operation,
  recipients,
  buildMail,
}: {
  /** The action this fan-out belongs to: `sendMail`'s own line cannot say which decision failed. */
  operation: string;
  recipients: readonly BewerbungEmpfaenger[];
  /** Composed per recipient, because each is told the seat they hold; the rest of the message is one text. */
  buildMail: (rollenText: string) => BewerbungEmail;
}): Promise<BewerbungMailOutcome> {
  return settleFanOut(operation, recipients, ({ rollenText }) => buildMail(rollenText));
}

/**
 * One message per mailbox, each carrying that mailbox's own links.
 *
 * Its own entry point rather than a widened `sendBewerbungMail`, whose `rollenText` would then mean
 * something different in each of the two.
 */
export async function sendBewerbungLinkMail({
  operation,
  recipients,
  buildMail,
}: {
  operation: string;
  recipients: readonly BewerbungLinkEmpfaenger[];
  buildMail: (seats: readonly BewerbungLinkSeat[]) => BewerbungEmail;
}): Promise<BewerbungMailOutcome> {
  return settleFanOut(operation, recipients, ({ seats }) => buildMail(seats));
}

/** Settles every address, whatever the message was composed from. */
async function settleFanOut<T extends { address: string }>(
  operation: string,
  recipients: readonly T[],
  buildMail: (recipient: T) => BewerbungEmail,
): Promise<BewerbungMailOutcome> {
  const settled = await Promise.allSettled(
    // `async`, so a compose that throws is inside the settled boundary too: without it the throw
    // escapes `.map()` before `allSettled` wraps anything and rejects the whole fan-out, reporting a
    // failure for a written decision (`docs/frontend/spec.md :: I39`).
    recipients.map(async (recipient) => {
      const mail = buildMail(recipient);

      return sendMail({ to: recipient.address, subject: mail.subject, html: mail.html, text: mail.text });
    }),
  );

  const delivered: string[] = [];
  const unreachable: string[] = [];

  settled.forEach((result, index) => {
    // One array mapped, so the index is the address; `forEach` walks only indices that exist.
    const { address } = recipients[index]!;

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
