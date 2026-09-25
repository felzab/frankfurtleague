import { NextResponse } from "next/server";

import { Webhook } from "svix";

import { frontend_config } from "@/core/config";
import { APIBadStatusError, isRecordMissing } from "@/core/errors";
import { logger } from "@/core/logging";
import { meldeZustellEreignis } from "@/features/bewerbungen/mutations";
import { leseZustellEreignis } from "@/features/bewerbungen/zustellung";
import { meldeZielZustellEreignis } from "@/features/zustellung/mutations";
import { isRuleRefusal } from "@/shared/utils/actionError";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { FLKontaktRolle } from "@/features/bewerbungen/schemas";
import type { NextRequest } from "next/server";

/** The three headers Svix signs with, which the verifier is handed by name. */
const SVIX_HEADERS = ["svix-id", "svix-timestamp", "svix-signature"] as const;

/**
 * What the provider is told, and it is the STATUS that carries the meaning: anything but 200 starts
 * a retry schedule of about thirty-two hours, after which Resend disables the endpoint and notifies
 * the account.
 */
// Built per call and never held at module scope: a `Response` carries a body stream that is consumed
// once, so a shared instance answers the second request of its kind with an unusable body.
const ANGEWENDET = (angewendet: readonly FLKontaktRolle[]) => NextResponse.json({ angewendet: angewendet }, { status: 200 });
// A boolean where the application's answer is a list of seats: the generic endpoint writes one
// record, so there is no set of seats for it to name.
const ZIEL_ANGEWENDET = (angewendet: boolean) => NextResponse.json({ angewendet: angewendet }, { status: 200 });
const KEINE_SIGNATUR = () => NextResponse.json({ error: "signature" }, { status: 400 });
const KEIN_BACKEND = () => NextResponse.json({ error: "backend" }, { status: 503 });

/**
 * Resend's delivery events, on neither spine the other route handlers take: `handlePublicRequest`
 * always answers 200, which would tell a caller that retries on non-200 that a forgery was accepted
 * (`docs/frontend/spec.md` §1.3).
 */
export async function POST(request: NextRequest) {
  // The exact bytes, because the signature is over them: parsing first and re-serialising changes
  // key order and whitespace, and every event would then verify as a forgery.
  const roh = await request.text();

  const headers = Object.fromEntries(SVIX_HEADERS.map((name) => [name, request.headers.get(name) ?? ""]));

  try {
    new Webhook(frontend_config.RESEND_WEBHOOK_SECRET).verify(roh, headers);
  } catch {
    // 400 rather than 503: a forgery is not worth thirty-two hours of retries, and neither is a
    // timestamp outside the verifier's tolerance. Nothing of the body reaches the line.
    logger.warn("mail.zustellung_unsigniert", { error_code: "FE-MAIL-003" });
    return KEINE_SIGNATUR();
  }

  return runWithIncomingTrace(async () => {
    let ereignis: unknown;
    try {
      ereignis = JSON.parse(roh);
    } catch {
      // Signed and unreadable is the provider changing shape, which no retry repairs.
      logger.error("mail.zustellung_unlesbar", undefined, { error_code: "FE-MAIL-003" });
      return ANGEWENDET([]);
    }

    // An untagged message and an event about no seat state are both acknowledged and recorded
    // nowhere, and a retried refusal would disable the endpoint over one.
    const meldung = leseZustellEreignis(ereignis);
    if (meldung === null) return ANGEWENDET([]);

    // The sign-in lane, which no store holds: anything but a delivery locks an administrator out
    // of their only way in, so the LINE is the record.

    // Never the address (`docs/logging/spec.md :: L9`).
    if (meldung.ziel === "anmeldung") {
      if (meldung.stand !== "zugestellt") {
        logger.warn("mail.anmeldelink_nicht_zugestellt", {
          error_code: "FE-MAIL-007",
          stand: meldung.stand,
          nachricht_id: meldung.nachricht_id,
        });
      }

      return ANGEWENDET([]);
    }

    // 200 because no retry repairs it, and a line because the alternative is a drop no operator can
    // tell from the sign-in mail's.
    if (meldung.ziel === "unplatzierbar") {
      // Never the raw kind: one that failed the set is a value the provider echoed back from
      // whatever it was handed (`docs/logging/spec.md :: L9`).
      logger.warn("mail.zustellung_unplatzierbar", { error_code: "FE-MAIL-006", grund: meldung.grund, ziel: meldung.art ?? undefined });
      return ANGEWENDET([]);
    }

    try {
      if (meldung.ziel === "bewerbung") {
        const { angewendet } = await meldeZustellEreignis(meldung.meldung);
        return ANGEWENDET(angewendet);
      }

      const { angewendet } = await meldeZielZustellEreignis(meldung.meldung);
      return ZIEL_ANGEWENDET(angewendet);
    } catch (error) {
      // Settled only on the API's answer about the event's own record: gone, or refused by a rule or the
      // unique index. Any other answer, a route mid-deploy or an unsent write, leaves it for the provider to send again.
      const beantwortet = isRecordMissing(error) || isRuleRefusal(error);

      // Never the tag block, the address or the provider's prose (`docs/logging/spec.md :: L9`).
      logger.error("mail.zustellung_ungeschrieben", undefined, {
        error_code: "FE-MAIL-003",
        name: error instanceof Error ? error.name : undefined,
        status: error instanceof APIBadStatusError ? error.statusCode : undefined,
      });

      // A record missing is one an erasure or the retention sweep has already taken, and a refusal is the
      // event's own answer: retrying either buys nothing and spends the endpoint's standing with the provider.
      return beantwortet ? ANGEWENDET([]) : KEIN_BACKEND();
    }
  });
}
