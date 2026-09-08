import { NextResponse } from "next/server";

import { Webhook } from "svix";

import { frontend_config } from "@/core/config";
import { APIBadStatusError, APINetworkError } from "@/core/errors";
import { logger } from "@/core/logging";
import { meldeZustellEreignis } from "@/features/bewerbungen/mutations";
import { leseZustellEreignis } from "@/features/bewerbungen/zustellung";
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
    // nowhere: the sign-in link is one, and a retried refusal would disable the endpoint over it.
    const meldung = leseZustellEreignis(ereignis);
    if (meldung === null) return ANGEWENDET([]);

    try {
      const { angewendet } = await meldeZustellEreignis(meldung);
      return ANGEWENDET(angewendet);
    } catch (error) {
      const unerreichbar = error instanceof APINetworkError || (error instanceof APIBadStatusError && error.statusCode >= 500);

      // Never the tag block, the address or the provider's prose (`docs/logging/spec.md :: L9`).
      logger.error("mail.zustellung_ungeschrieben", undefined, {
        error_code: "FE-MAIL-003",
        name: error instanceof Error ? error.name : undefined,
        status: error instanceof APIBadStatusError ? error.statusCode : undefined,
      });

      // A 404 is an application the retention sweep has already erased, and every other answered
      // status is a contract this side got wrong: retrying either buys nothing and spends the
      // endpoint's standing with the provider.
      return unerreichbar ? KEIN_BACKEND() : ANGEWENDET([]);
    }
  });
}
