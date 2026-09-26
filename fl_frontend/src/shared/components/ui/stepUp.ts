"use client";

import { createContext } from "react";

/**
 * The control that runs the passkey prompt as a confirmation, wherever a page asks for one. Here, beside
 * the context and with no passkey client, so a public page rendering a shared control loads none.
 */
export const STEP_UP_LABEL = "Mit Passkey bestätigen";

/** What a control says while the prompt is open: nothing has been sent yet, so never the write's own running words. */
export const STEP_UP_RUNNING = "Bestätigt...";

/** A refused or cancelled prompt, an unknown authenticator and an unverified one read alike to the person at the prompt. */
export const STEP_UP_REFUSED = "Wir konnten Dich nicht mit einem Passkey bestätigen.";

/** What an administrator's step-up write asks of its page before its press sends it. */
export interface StepUp {
  /** Whether a write sent at `now` would be refused for want of a recent confirmation. */
  readonly isStale: (now: number) => boolean;
  /** The passkey assertion, answering whether it succeeded: a success is a new sign-in, whose cookie the next write carries. */
  readonly confirm: () => Promise<boolean>;
}

// Undefined outside the administrator's shell: a control there asks nothing first, and the server's own
// refusal is the whole of its step-up.
export const StepUpContext = createContext<StepUp | undefined>(undefined);
