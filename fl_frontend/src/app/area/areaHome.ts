import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";

import type { WayOn } from "@/kit/StatusCard";

/**
 * Where the not-found cards of a team's and a person's frame lead on: the person's own Übersicht, which lists each of
 * their places or sends a person holding one straight on to it. Never a page of the frame the card stands in, whose
 * address the card may be refusing.
 */
export const AREA_HOME = { label: COPY.shared.end.toOverview, href: ROUTES.area.path() } as const satisfies WayOn;
