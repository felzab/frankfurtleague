import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import type { StatusCardProps } from "@/kit/StatusPage";

/**
 * Where every status card of a team's and a person's frame leads on: the person's own Übersicht, which lists each of
 * their places or sends a person holding one straight on to it. Never a page of the frame the card stands in, whose
 * address the card may be refusing.
 */
export const AREA_HOME = { label: COPY.shared.end.toOverview, href: ROUTES.area.path() } as const satisfies StatusCardProps["next"];
