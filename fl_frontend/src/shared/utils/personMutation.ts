import { refresh } from "next/cache";

import { APIBadStatusError } from "@/core/errors";
import { funktionenOf, isSeatAt } from "@/core/funktionen";
import { logger } from "@/core/logging";
import { getSubjectSession } from "@/core/subject";

import { ANMELDUNG_ABGELAUFEN, SITZ_WEG } from "./actionError";
import { runGuardedMutation, stepUpRequired } from "./adminMutation";
import { logVerweigert } from "./verweigert";

import type { Funktion } from "@/core/funktionen";
import type { SubjectSession } from "@/core/subject";
import type { ActionFailure } from "@/shared/types/types";
import type { Verweigerung } from "./verweigert";

/** The team and season a person's write claims a seat on, as the action's own argument carries them. */
export type SeatClaim = { readonly team_id: string; readonly saison_id: string };

/** What a guarded body runs for: the person the spine resolved, and every seat they hold at the claimed address. */
export type PersonHeld = {
  readonly subject: SubjectSession;
  readonly seats: readonly [Extract<Funktion, { art: "kontakt" }>, ...Extract<Funktion, { art: "kontakt" }>[]];
};

/**
 * A person's server action's spine. The seat is derived here from the session rather than named by the
 * caller, so no action can skip the check; the backend judges the same request again in its transaction.
 */
export async function runPersonMutation<T extends { success: boolean }>(
  mutationName: string,
  claimed: SeatClaim,
  fn: (held: PersonHeld) => Promise<T>,
): Promise<T | ActionFailure> {
  const verdict: { grund: Extract<Verweigerung, "keine_sitzung" | "kein_sitz"> } = { grund: "keine_sitzung" };

  // A request can hand a server action anything at all, so the claim is read as possibly absent: an
  // address it does not carry holds no seat.
  const address: Partial<SeatClaim> | undefined = claimed;
  const teamId = address?.team_id;
  const saisonId = address?.saison_id;

  const resolve = async (): Promise<PersonHeld | null> => {
    const subject = await getSubjectSession();
    const [erster, ...weitere] =
      subject === null || typeof teamId !== "string" || typeof saisonId !== "string"
        ? []
        : funktionenOf(subject).funktionen.filter((funktion) => isSeatAt(funktion, teamId, saisonId));

    if (subject !== null && erster !== undefined) return { subject: subject, seats: [erster, ...weitere] };

    verdict.grund = subject === null ? "keine_sitzung" : "kein_sitz";
    logVerweigert(mutationName, verdict.grund);
    return null;
  };

  return runGuardedMutation(
    mutationName,
    // Each refusal in the words of its repair: a sign-in for a lapsed session, a reload for a seat gone.
    { lane: "Person", resolve, forbidden: () => Promise.resolve(verdict.grund === "keine_sitzung" ? ANMELDUNG_ABGELAUFEN : SITZ_WEG) },
    fn,
  );
}

/**
 * The spine of a person's write claiming a record of their own rather than a seat: the session alone is
 * judged here, and the backend authorises the record itself.
 */
export async function runPersonRecordMutation<T extends { success: boolean }>(
  mutationName: string,
  fn: (subject: SubjectSession) => Promise<T>,
): Promise<T | ActionFailure> {
  const resolve = async (): Promise<SubjectSession | null> => {
    // Never narrowed through `funktionenOf`: a withdrawal must reach a past season's seat and a retired
    // record, which no Funktion carries.
    const subject = await getSubjectSession();
    if (subject === null) logVerweigert(mutationName, "keine_sitzung");

    return subject;
  };

  return runGuardedMutation(mutationName, { lane: "Person", resolve, forbidden: ANMELDUNG_ABGELAUFEN }, async (subject) => {
    try {
      return await fn(subject);
    } catch (error) {
      // A grant holder's write the backend's own window refused, one the page's check admitted at the
      // window's edge: answered as the admin spine answers it, so the page's next press asks for the
      // passkey (`docs/frontend/spec.md :: I493`).
      if (!(error instanceof APIBadStatusError && error.serverErrorCode === "REQ-AUTH-009")) throw error;

      logger.error(`Person mutation refused for want of a confirmation: ${mutationName}`, error, {
        error_code: error.code,
        server_error_code: error.serverErrorCode,
        status: error.statusCode,
      });
      refresh();
      return stepUpRequired();
    }
  });
}
