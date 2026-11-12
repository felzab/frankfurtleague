import { getSubjectSession } from "@/core/subject";
import { runWithIncomingTrace } from "@/core/traceScope";

/**
 * Runs one person-tier read with the signed-in person recorded as the request's actor: a render opens
 * no scope for the subject lookup to record into, and the backend refuses a person's route naming nobody.
 */
export async function runPersonRead<T>(fn: () => Promise<T>): Promise<T> {
  return runWithIncomingTrace(async () => {
    // Inside the scope just opened, where the lookup records its actor on every call, memoised or not.
    // With no person signed in it records none, and `sendToBackend` refuses the unattributed call unsent.
    await getSubjectSession();

    return fn();
  });
}
