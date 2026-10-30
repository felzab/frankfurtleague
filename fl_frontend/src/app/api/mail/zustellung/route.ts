import { NextResponse } from "next/server";

import { Webhook } from "svix";
import z from "zod";

import { resendWebhookSecret } from "@/core/config";
import { APIBadStatusError } from "@/core/errors";
import { outboxPostEvent } from "@/core/generated/client/sdk";
import { OutboxPostEventBody } from "@/core/generated/zod/inputs";
import { logger } from "@/core/logging";
import { OUTBOX_TAG } from "@/core/mailKinds";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { FLOutboxEventPayload } from "@/core/generated/client/types";
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
const APPLIED = (applied: boolean) => NextResponse.json({ applied: applied }, { status: 200 });
const NO_SIGNATURE = () => NextResponse.json({ error: "signature" }, { status: 400 });
const NO_BACKEND = () => NextResponse.json({ error: "backend" }, { status: 503 });

/**
 * What a Postausgang mail's event carries: the envelope's own instant, which orders it, the row's id among the tags the
 * send rode out with, and the detail each kind of event adds (https://resend.com/docs/webhooks/emails/bounced.md).
 */
const OutboxEventSchema = z.object({
  type: z.string(),
  created_at: z.string(),
  data: z.object({
    tags: z.record(z.string(), z.string()),
    bounce: z.object({ type: z.string(), subType: z.string().optional() }).optional(),
    suppressed: z.object({ type: z.string() }).optional(),
    failed: z.object({ reason: z.string() }).optional(),
  }),
});

type OutboxEvent = z.infer<typeof OutboxEventSchema>;

/** The state one event leaves on the row, or `null` for an event that leaves none, `email.sent` among them. */
function outboxStandFrom({ type, data }: OutboxEvent): Pick<FLOutboxEventPayload, "stand" | "grund"> | null {
  switch (type) {
    case "email.delivered":
      return { stand: "delivered", grund: null };
    // A temporary bounce is the receiving server asking for later, not the mailbox refusing: reading it as permanent
    // would mark a full mailbox unreachable.
    case "email.bounced":
      return { stand: data.bounce?.type === "Permanent" ? "undeliverable" : "delayed", grund: data.bounce?.subType ?? null };
    case "email.suppressed":
      return { stand: "suppressed", grund: data.suppressed?.type ?? null };
    case "email.complained":
      return { stand: "complaint", grund: null };
    case "email.delivery_delayed":
      return { stand: "delayed", grund: null };
    // The documented reason is the league's own daily quota, which says nothing about the address: a permanent state
    // here would mark the address unreachable for the sender's fault.
    case "email.failed":
      return { stand: "delayed", grund: data.failed?.reason ?? null };
    default:
      return null;
  }
}

/**
 * The write one event asks for, or `null` where it asks none: an event about no row, a mail sent before the Postausgang
 * among them, and one that leaves no state. **Every `null` is answered 200**: the provider retries a non-200 for
 * thirty-two hours and then disables the endpoint.
 */
function readOutboxEvent(raw: unknown): FLOutboxEventPayload | null {
  const read = OutboxEventSchema.safeParse(raw);
  const id = read.data?.data.tags[OUTBOX_TAG];
  if (read.data === undefined || id === undefined) return null;

  const stand = outboxStandFrom(read.data);
  if (stand === null) return null;

  const event = { id: id, am: read.data.created_at, ...stand };
  // The provider's reason is its own token, kept only where the endpoint takes it: the state stands without one.
  const payload = OutboxPostEventBody.safeParse(event).data ?? OutboxPostEventBody.safeParse({ ...event, grund: null }).data;
  if (payload !== undefined) return payload;

  // 200 because no retry repairs it, and a line because the alternative is a drop nobody sees.
  logger.warn("mail.delivery_unplaceable", { grund: "outbox_unreadable" });
  return null;
}

function signedByProvider(roh: string, headers: Record<string, string>): boolean {
  const secret = resendWebhookSecret();
  // Held by production alone, the one deployment the provider sends to, so a call anywhere else
  // carries nothing this deployment can verify.
  if (secret === undefined) return false;

  try {
    new Webhook(secret).verify(roh, headers);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resend's delivery events, on neither spine the other route handlers take: `handlePublicRequest`
 * always answers 200, which would tell a caller that retries on non-200 that a forgery was accepted.
 */
export async function POST(request: NextRequest) {
  // The exact bytes, because the signature is over them: parsing first and re-serialising changes
  // key order and whitespace, and every event would then verify as a forgery.
  const roh = await request.text();

  const headers = Object.fromEntries(SVIX_HEADERS.map((name) => [name, request.headers.get(name) ?? ""]));

  if (!signedByProvider(roh, headers)) {
    // 400 rather than 503: a forgery is not worth thirty-two hours of retries, and neither is a
    // timestamp outside the verifier's tolerance. Nothing of the body reaches the line.
    logger.warn("mail.delivery_unsigned");
    return NO_SIGNATURE();
  }

  return runWithIncomingTrace(async () => {
    let event: unknown;
    try {
      event = JSON.parse(roh);
    } catch {
      // Signed and unreadable is the provider changing shape, which no retry repairs.
      logger.error("mail.delivery_unreadable");
      return APPLIED(false);
    }

    // Found by the row's own id among the send's tags, whatever else they hold.
    const outbox = readOutboxEvent(event);
    if (outbox === null) return APPLIED(false);

    try {
      const { applied: angewendet } = await outboxPostEvent(outbox);
      return APPLIED(angewendet);
    } catch (error) {
      return unanswered(error);
    }
  });
}

/**
 * What the provider is told where the API did not take an event: the line, then a retry. The endpoint answers every
 * event it takes, a row gone or a state it may not follow among them, with `angewendet`, so any failure is a route
 * mid-deploy or a write that never landed, which the provider's later send repairs.
 */
function unanswered(error: unknown): NextResponse {
  // Never the tag block, the address or the provider's prose.
  logger.error("mail.delivery_unwritten", undefined, {
    name: error instanceof Error ? error.name : undefined,
    status: error instanceof APIBadStatusError ? error.statusCode : undefined,
  });

  return NO_BACKEND();
}
