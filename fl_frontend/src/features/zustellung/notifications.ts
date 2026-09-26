import "server-only";

import { APINetworkError, MailSendError } from "@/core/errors";
import { logger } from "@/core/logging";
import { MailRecipientError, MailWithheldError, sendMail } from "@/core/mail";
import { mailIdempotencyKey } from "@/core/mailIdempotencyKey";
import { markOutcomeUnknown } from "@/core/requestScope";

import { meldeZielZustellungAbgewiesen, meldeZielZustellungAngenommen } from "./mutations";
import { FLZustellungAbgewiesenPayloadSchema } from "./schemas";

import type { OutboundMail } from "@/core/mail";
import type { ZustellAnlass } from "@/features/bewerbungen/zustellung";
import type { FLZustellungZiel } from "./schemas";

/**
 * Which record a fan-out's messages are about, so an accepted send is recorded against it. The
 * application's own twin keys on a seat instead, there being three of them behind one document.
 */
export type ZielAuftrag = {
  ziel: FLZustellungZiel;
  zielId: string;
  anlass: ZustellAnlass;
  /**
   * What the key is scoped to beside the record, a day or a press, set ONLY where the body cannot
   * change inside the provider's window. It also lets the transport retry a broken send.
   */
  idempotenzTag?: string;
};

/** Every list is in the order the addresses were tried. */
export type ZielMailOutcome = {
  delivered: readonly string[];
  unreachable: readonly string[];
  /**
   * The subset of `unreachable` this deployment never tried, `sendMail` having withheld it.
   *
   * A caller telling a person their mail could not be sent needs the two apart: outside production
   * every address lands in `unreachable`.
   */
  withheld: readonly string[];
  /**
   * The addresses whose send broke off unanswered, which the provider may have accepted: in neither
   * list above. The fan-out marks the request, and its spine answers it as of unknown outcome
   * (`docs/frontend/spec.md :: I366`).
   */
  ungewiss: readonly string[];
};

/** One message, without the envelope the fan-out fills in. */
export type ZielMail = Pick<OutboundMail, "subject" | "html" | "text">;

/**
 * What the provider echoes back on every event about this message, and the only thing that routes
 * one to a record: the kind alone names a population, so a report without the row's own id reaches
 * nothing.
 */
export function zielZustellungTags({ ziel, zielId, anlass }: ZielAuftrag): Record<string, string> {
  return { ziel: ziel, ziel_id: zielId, anlass: anlass };
}

/**
 * **Only for a message whose body cannot change inside the provider's 24-hour window**, a key reused
 * over another body being refused: a token minted again under one record goes keyless, one minted on
 * its own record keys safely.
 */
export function zielIdempotenzSchluessel({ ziel, zielId, anlass }: ZielAuftrag, tag: string, address: string): string {
  return mailIdempotencyKey([anlass, ziel, zielId, tag], address);
}

/** The record one accepted message covered, stamped with THIS server's clock. */
async function meldeAngenommen(auftrag: ZielAuftrag, nachrichtId: string, operation: string): Promise<void> {
  try {
    const { angewendet } = await meldeZielZustellungAngenommen({
      ziel: auftrag.ziel,
      ziel_id: auftrag.zielId,
      nachricht_id: nachrichtId,
      // This host's clock, which the backend orders against the record's own last accept and
      // against no provider stamp
      // (`fl_backend/app/api/bewerbungen/services.py :: zustellung_send_applies`).
      am: new Date().toISOString(),
    });

    // Discarded, a `false` reads exactly like a recorded send, and at this commit it is the answer
    // for every record whose carrier no writer has created.
    if (!angewendet) {
      logger.warn("zustellung.angenommen_nicht_angewendet", { error_code: "FE-MAIL-006", ziel: auftrag.ziel, operation: operation });
    }
  } catch (error) {
    // Never thrown on: the message HAS gone, and a caller told otherwise would report a send that
    // happened as one that did not. Name only, never the error (`docs/logging/spec.md :: L9`).
    logger.error("zustellung.angenommen_ungemeldet", undefined, {
      error_code: "FE-MAIL-003",
      name: error instanceof Error ? error.name : undefined,
      operation: operation,
    });
  }
}

/**
 * A retry that could still land, and a request that never reached the provider, say nothing about the
 * mailbox: a record marking one unreachable spends the person's one reminder and lets the deadline
 * erase the row.
 */
function versandIstAbgewiesen(reason: unknown): boolean {
  if (reason instanceof MailRecipientError) return true;

  return reason instanceof MailSendError && !reason.isTransient;
}

/** The record an address the provider would not take covered, stamped with THIS server's clock. */
async function meldeAbgewiesen(auftrag: ZielAuftrag, reason: unknown, operation: string): Promise<void> {
  // Screened through the mirror rather than sent as it came: the token is the provider's own JSON,
  // and one past the endpoint's bound would be answered 422, losing the record over its reason.
  const token = reason instanceof MailSendError ? reason.providerErrorName : reason instanceof Error ? reason.name : null;
  const gescreent = FLZustellungAbgewiesenPayloadSchema.shape.grund.safeParse(token ?? null);

  try {
    await meldeZielZustellungAbgewiesen({
      ziel: auftrag.ziel,
      ziel_id: auftrag.zielId,
      grund: gescreent.success ? gescreent.data : null,
      // This host's clock, as the accepted send's is: the backend orders the two against each other
      // (`fl_backend/app/api/bewerbungen/services.py :: zustellung_send_applies`).
      am: new Date().toISOString(),
    });
  } catch (error) {
    // Never thrown on: the person's page is answered from the fan-out's own result, and the next
    // send repairs the record. Name only, never the error (`docs/logging/spec.md :: L9`).
    logger.error("zustellung.abweisung_ungemeldet", undefined, {
      error_code: "FE-MAIL-003",
      name: error instanceof Error ? error.name : undefined,
      operation: operation,
    });
  }
}

// `fl_frontend/src/features/bewerbungen/notifications.ts :: settleFanOut`'s twin rather than a
// branch inside it: that one's recipient carries the seats a message answers for and this one's
// carries none, so one function would take a shape neither caller can satisfy.
/** One message to every address, **settling all of them**: a refused address must not cost the others their message. */
export async function sendZielMail({
  operation,
  auftrag,
  recipients,
  buildMail,
}: {
  /** The action this fan-out belongs to: `sendMail`'s own line cannot say which decision failed. */
  operation: string;
  auftrag: ZielAuftrag;
  recipients: readonly string[];
  buildMail: (address: string) => ZielMail;
}): Promise<ZielMailOutcome> {
  const settled = await Promise.allSettled(
    // `async`, so a compose that throws is inside the settled boundary too: without it the throw
    // escapes `.map()` before `allSettled` wraps anything and rejects the whole fan-out, reporting a
    // failure for a written decision (`docs/frontend/spec.md :: I39`).
    recipients.map(async (address) => {
      const mail = buildMail(address);

      return sendMail({
        to: address,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        tags: zielZustellungTags(auftrag),
        idempotencyKey: auftrag.idempotenzTag === undefined ? undefined : zielIdempotenzSchluessel(auftrag, auftrag.idempotenzTag, address),
      });
    }),
  );

  const delivered: string[] = [];
  const unreachable: string[] = [];
  const withheld: string[] = [];
  const ungewiss: string[] = [];
  const gemeldet: Promise<void>[] = [];

  settled.forEach((result, index) => {
    // One array mapped, so the index is the address; `forEach` walks only indices that exist.
    const address = recipients[index]!;

    if (result.status === "fulfilled") {
      delivered.push(address);
      // An accepted answer carrying no id joins nothing: recording a state with no message to attach
      // it to would mark the record delivered on the strength of the request alone.
      if (result.value.id !== null) gemeldet.push(meldeAngenommen(auftrag, result.value.id, operation));
      return;
    }

    if (result.reason instanceof APINetworkError) {
      ungewiss.push(address);
      markOutcomeUnknown();
    } else unreachable.push(address);
    // Beside rather than instead: every caller reading `unreachable` alone keeps the answer it had.
    if (result.reason instanceof MailWithheldError) withheld.push(address);
    // The submit is where a refused address is learnt at all: no message was minted, so no delivery
    // event will ever carry this to the record the clocks read.
    if (versandIstAbgewiesen(result.reason)) gemeldet.push(meldeAbgewiesen(auftrag, result.reason, operation));
    // Name only, never the error: `fl_frontend/src/core/logFormat.ts :: serializeError` writes a
    // message and a stack, and the address stays off the stream (`docs/logging/spec.md :: L9`).
    logger.error("zustellung.mail_failed", undefined, {
      error_code: "FE-MAIL-002",
      name: result.reason instanceof Error ? result.reason.name : undefined,
      operation: operation,
    });
  });

  // Together rather than one after another: each round trip is independent of the others.
  await Promise.all(gemeldet);

  return { delivered: delivered, unreachable: unreachable, withheld: withheld, ungewiss: ungewiss };
}
