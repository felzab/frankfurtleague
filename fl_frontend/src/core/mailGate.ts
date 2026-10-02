import "server-only";

import { apiClient } from "./api";
import { APINetworkError } from "./errors";
import { logger } from "./logging";
import { FLGesperrtResponseSchema } from "./schemas";

import type { FLGesperrtPayload } from "./schemas";

/** Whether a message may go to its address; `admitted` alone is sent. */
export type MailVerdict = "admitted" | "barred" | "failed";

/**
 * Whether a message may go to this address: the ban list's whole say over mail, asked by
 * `fl_frontend/src/core/mail.ts :: sendMail` alone and never spelled a second time. It never throws.
 */
export async function mayReceiveMail(to: string): Promise<MailVerdict> {
  const payload: FLGesperrtPayload = { email: to };
  let gesperrt: boolean;

  try {
    // In the body and on no query parameter: a URL carrying an address reaches the edge's access
    // line, which nothing downstream un-logs (`docs/logging/spec.md :: L11`).
    ({ gesperrt } = await apiClient("/identitaet/gesperrt", FLGesperrtResponseSchema, {
      method: "POST",
      readOnly: true,
      authType: "system",
      body: JSON.stringify(payload),
    }));
  } catch (failed) {
    // Closed: a send past a failed read would defeat the ban. The name alone, an error on this path
    // carrying the address it was asked about (`docs/logging/spec.md :: L9`).
    logger.error("mail.gate_failed", undefined, {
      error_code: "FE-MAIL-012",
      name: failed instanceof Error ? failed.name : "unknown",
      is_timeout: failed instanceof APINetworkError ? failed.isTimeout : undefined,
    });
    return "failed";
  }

  if (!gesperrt) return "admitted";

  // Bare: an address is what a ban keeps off every line, and the request's trace joins this one to
  // the send it stopped.
  logger.info("mail.barred");
  return "barred";
}
