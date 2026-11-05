import "server-only";

import { linkInvalid } from "@/kit/MailedPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

import type { EndState } from "@/kit/MailedPage";

const WORDS = SERVER_COPY.schiedsrichterConfirmation;

/** The start page, the next step after an objection and after a link that no longer holds. */
export const TO_HOME = { label: COPY.shared.end.toHome, href: ROUTES.home.path() };

/** A link that holds no more, as the page opens on it and as a press ends on it: one message for every cause. */
export const LINK_INVALID: EndState = linkInvalid(TO_HOME);

/**
 * The end an answer reaches, its title saying all there is: a confirmed entry leads to signing in, which the
 * person may now do with the address the link went to; an objection, on the danger tint, to the start page.
 */
export const END = {
  confirmed: {
    tone: "success",
    title: WORDS.confirmed,
    sentence: WORDS.confirmedSentence,
    next: { label: COPY.shared.verb.signIn, href: ROUTES.signIn.path() },
  },
  objected: { tone: "danger", title: WORDS.objected, sentence: WORDS.objectedSentence, next: TO_HOME },
} as const satisfies Readonly<Record<string, EndState>>;
