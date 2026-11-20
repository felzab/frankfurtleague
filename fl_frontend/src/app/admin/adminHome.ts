import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";

import type { StatusCardProps } from "@/kit/StatusCard";

/**
 * Where every status card of the administration leads on: the area's root, which leads to the Übersicht of the season
 * the site is on. Its own module, free of the layout's session read, since the area's `error.tsx` is a client module.
 */
export const ADMIN_HOME = { label: COPY.shared.end.toOverview, href: ROUTES.admin.path() } as const satisfies StatusCardProps["next"];
