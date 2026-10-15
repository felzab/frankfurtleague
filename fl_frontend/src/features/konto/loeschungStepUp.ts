import "server-only";

import { getKontoSession, passkeysOf, readRequestSession } from "@/core/auth";
import { confirmedUntil } from "@/shared/utils/kontoMutation";

import type { GrantHolderStepUp } from "./components/views/LoeschungView";

/** What the interstitial reads of a grant holder's session before their press (`docs/frontend/spec.md :: I707`). */
export interface GrantHolderReading {
  readonly stepUp: GrantHolderStepUp;
  /** Without one there is nothing to confirm by, so the page sends them to set one up rather than to the prompt. */
  readonly hasPasskey: boolean;
}

/** `null` where the request carries no session at all, which the person's own lookup turns away first. */
export async function readGrantHolderStepUp(): Promise<GrantHolderReading | null> {
  const served = await readRequestSession();
  if (served === null) return null;

  const [judged, held] = await Promise.all([getKontoSession(), passkeysOf(served.user.id)]);
  // A session the account page's guard refuses, one the mailbox made among them, is inside neither window:
  // the press asks first, and the confirmation mints a session the guard serves.
  const windows = judged === null ? { freshUntil: null, enrolmentUntil: null, servedAt: Date.now() } : confirmedUntil(judged);

  return { stepUp: { ...windows, holderId: served.user.id }, hasPasskey: held.length > 0 };
}
