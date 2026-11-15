import "server-only";

import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

import type { FLBewerbungFormResponse } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";

const WORDS = SERVER_COPY.bewerbung.end;

/** The start page, every end's one way on. */
export const TO_HOME = { label: COPY.shared.end.toHome, href: ROUTES.home.path() };

/** The outcome replacing the form, a replayed press alike. */
export const SUBMITTED: EndState = { tone: "success", title: WORDS.submitted, next: TO_HOME };

/** The card standing in the form's place, or `null` while the window runs: the state is the server's whole judgement. */
export function endOf(window: FLBewerbungFormResponse["window"]): EndState | null {
  if (window === null) return { tone: "info", title: WORDS.none, next: TO_HOME };
  switch (window.state) {
    case "running":
      return null;
    case "ended":
      return { tone: "warn", title: WORDS.over, next: TO_HOME };
    case "upcoming":
      return { tone: "info", title: WORDS.opensOn(dayOf(window.start)), next: TO_HOME };
    case "closed":
      return { tone: "info", title: WORDS.closed, next: TO_HOME };
  }
}
