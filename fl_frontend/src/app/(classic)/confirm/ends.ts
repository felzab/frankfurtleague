import "server-only";

import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { linkInvalid, TO_HOME } from "@/kit/mailedLinkState";

import type { EndState } from "@/kit/MailedPage";

const WORDS = SERVER_COPY.entryConfirmation;

export const LINK_INVALID: EndState = linkInvalid(TO_HOME);

const TO_SIGN_IN = { label: COPY.shared.verb.signIn, href: ROUTES.signIn.path() };

/**
 * The end an entry's answer reaches, a contact's seat and a referee's entry alike, its title saying all there is: a
 * confirmed entry leads to signing in, which the person may now do with the address the link went to; an objection,
 * on the danger tint, to the start page.
 */
export const END = {
  confirmed: { tone: "success", title: WORDS.confirmed, next: TO_SIGN_IN },
  objected: { tone: "danger", title: WORDS.objected, next: TO_HOME },
} as const satisfies Readonly<Record<string, EndState>>;

/**
 * The end a pupil's answer reaches, its title saying all there is: the registration waits on the team, which mails the
 * pupil nothing when it admits them, so the card promises no word to come and leads to signing in.
 */
export const REGISTRIERUNG_CONFIRMED = {
  tone: "success",
  title: SERVER_COPY.registrierungConfirmation.confirmed,
  next: TO_SIGN_IN,
} as const satisfies EndState;
