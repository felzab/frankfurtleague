import "server-only";

import { linkInvalid } from "@/kit/mailedLinkState";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

import type { EndState } from "@/kit/MailedPage";

/** The start page, the next step after a link that no longer holds. */
export const TO_HOME = { label: COPY.shared.end.toHome, href: ROUTES.home.path() };

/** A link that holds no more, as the page opens on it and as a press ends on it: one message for every cause. */
export const LINK_INVALID: EndState = linkInvalid(TO_HOME);

/**
 * The end the answer reaches, its title saying all there is: the registration waits on the team, which mails the pupil
 * nothing when it admits them, so the card promises no word to come and leads to signing in.
 */
export const CONFIRMED = {
  tone: "success",
  title: SERVER_COPY.registrierungConfirmation.confirmed,
  next: { label: COPY.shared.verb.signIn, href: ROUTES.signIn.path() },
} as const satisfies EndState;
