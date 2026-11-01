import { PersonReadWithoutSubjectError } from "@/core/errors";
import { getSubjectSession } from "@/core/subject";

import { runWithIncomingTrace } from "./traceScope";

/**
 * Runs one person-tier read with the signed-in person recorded as the request's actor: a render opens
 * no scope for the subject lookup to record into, and the backend refuses a person's route naming nobody.
 */
export async function runPersonRead<T>(fn: () => Promise<T>): Promise<T> {
  return runWithIncomingTrace(async () => {
    // Inside the scope just opened, where the lookup records its actor on every call, memoised or not.
    const subject = await getSubjectSession();
    // Thrown to the error boundary: a page reads the session before any read, so only a caller
    // skipping that check reaches this, a programming error that must be loud.
    if (subject === null) throw new PersonReadWithoutSubjectError();

    return fn();
  });
}
