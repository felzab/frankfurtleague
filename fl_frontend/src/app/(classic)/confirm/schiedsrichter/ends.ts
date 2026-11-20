import "server-only";

import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { linkInvalid } from "@/kit/mailedLinkState";

import type { EndState } from "@/kit/MailedPage";

const WORDS = SERVER_COPY.entryConfirmation;

export const TO_HOME = { label: COPY.shared.end.toHome, href: ROUTES.home.path() };

export const LINK_INVALID: EndState = linkInvalid(TO_HOME);

/**
 * The end an answer reaches, its title saying all there is: a confirmed entry leads to signing in, which the
 * person may now do with the address the link went to; an objection, on the danger tint, to the start page.
 */
export const END = {
  confirmed: { tone: "success", title: WORDS.confirmed, next: { label: COPY.shared.verb.signIn, href: ROUTES.signIn.path() } },
  objected: { tone: "danger", title: WORDS.objected, next: TO_HOME },
} as const satisfies Readonly<Record<string, EndState>>;
