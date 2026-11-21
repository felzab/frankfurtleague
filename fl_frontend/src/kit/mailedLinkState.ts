import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";

import type { EndState } from "./MailedPage";
import type { WayOn } from "./StatusCard";

/*
 * What a mailed page's link reads as, for the modules that word it without drawing the page: the end a link no longer
 * valid reaches, and the start page's way that the ends and the not-found cards offer, and the frameless error cards
 * beneath their retry. Apart from `MailedPage`, whose one-shot form brings the client's stack to every route importing
 * it, error boundaries among them; apart from `mailedMetadata`, whose share image brings the server catalogue.
 */

export const TO_HOME = { label: COPY.shared.end.toHome, href: ROUTES.home.path() } as const satisfies WayOn;

/**
 * The link no longer valid, one message for an expired, mistyped or tampered link alike, as the page opens on it
 * and as a press ends on it where the link stopped holding since the page opened.
 */
export function linkInvalid(next: WayOn): EndState {
  return { tone: "warn", title: COPY.template.linkInvalid, next };
}
