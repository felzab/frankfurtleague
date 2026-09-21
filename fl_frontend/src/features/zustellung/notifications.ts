import "server-only";

import { logger } from "@/core/logging";
import { sendMail } from "@/core/mail";

import { meldeZielZustellungAngenommen } from "./mutations";

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
   * The day the idempotency key is scoped to, set ONLY where the body cannot change inside the
   * provider's window: a key reused over a changed body is refused rather than ignored.
   */
  idempotenzTag?: string;
};

/** Both lists are in the order the addresses were tried. */
export type ZielMailOutcome = {
  delivered: readonly string[];
  unreachable: readonly string[];
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
 * **Only for a message whose body cannot change inside the provider's 24-hour window.** A reused key
 * over a different body is refused rather than ignored, so any message carrying a freshly minted
 * token must go without one.
 */
export function zielIdempotenzSchluessel({ ziel, zielId, anlass }: ZielAuftrag, tag: string): string {
  return [anlass, ziel, zielId, tag].join("_");
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
        idempotencyKey: auftrag.idempotenzTag === undefined ? undefined : zielIdempotenzSchluessel(auftrag, auftrag.idempotenzTag),
      });
    }),
  );

  const delivered: string[] = [];
  const unreachable: string[] = [];
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

    unreachable.push(address);
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

  return { delivered: delivered, unreachable: unreachable };
}
