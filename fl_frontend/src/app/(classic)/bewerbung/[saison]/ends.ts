import "server-only";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

import type { CalendarDay } from "@/core/format";
import type { FLBewerbungFormResponse } from "@/core/generated/client/types";
import type { EndState } from "@/kit/MailedPage";

const WORDS = SERVER_COPY.bewerbung.end;

/** The start page, every end's one way on. */
const TO_HOME = { label: COPY.shared.end.toHome, href: ROUTES.home.path() };

/** The outcome replacing the form, a replayed press alike. */
export const SUBMITTED: EndState = { tone: "success", title: WORDS.submitted, next: TO_HOME };

/**
 * The card standing in the form's place, or `null` while the window runs, which is the server's whole judgement. An
 * ended season comes before any date: it takes no application again, so a window's own days would send a school to
 * wait for one that never reopens.
 */
export function endOf(window: FLBewerbungFormResponse["window"], today: CalendarDay): EndState | null {
  if (window === null) return { tone: "info", title: WORDS.none, next: TO_HOME };
  if (window.running) return null;
  if (window.saison_ended) return { tone: "warn", title: WORDS.over, next: TO_HOME };
  if (today < window.start) return { tone: "info", title: WORDS.opensOn(window.start as CalendarDay), next: TO_HOME };
  return { tone: "info", title: WORDS.closed, next: TO_HOME };
}
