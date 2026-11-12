import "server-only";

import { redirect } from "next/navigation";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { readOwnSaisons } from "@/features/roles/queries";
import { readAsRoleHolder, requireRole } from "@/features/roles/resolvers";

import type { PersonKind } from "@/features/roles/queries";
import type { StatusCardProps } from "@/kit/StatusCard";

/** Each person place's two rows: its address without a season, and a season's Übersicht. */
const PLACE = {
  spieler: { area: ROUTES.areaSpieler, overview: ROUTES.spielerOverview },
  schiedsrichter: { area: ROUTES.areaSchiedsrichter, overview: ROUTES.schiedsrichterOverview },
} as const;

/**
 * Whether `saison` is one the person's own records of `kind` stand in, which a season's page holds its address to; a
 * person holding no such Funktion is sent on before. The seasons are the frame's own read, so judging the address
 * costs no request.
 */
export async function isOwnSaison(kind: PersonKind, saison: string): Promise<boolean> {
  await requireRole(kind, PLACE[kind].overview.path(saison));
  const saisons = await readAsRoleHolder(kind, () => readOwnSaisons(kind));
  return saisons?.entries.some((entry) => entry.id === saison) === true;
}

/**
 * A place's address without a season, the one „Funktion wechseln“, a mail and the sign-in lead to: a redirect to the
 * Übersicht of the season the frame's season button stands on, or, while the person's records stand in no season, the
 * card saying so with the way to Konto. The seasons are the frame's own read, so they cost the page no request of its
 * own; the frame's shell streams first, so the redirect reaches the browser inside the stream.
 */
export async function standardSaisonCard(kind: PersonKind): Promise<StatusCardProps> {
  await requireRole(kind, PLACE[kind].area.path());
  const saisons = await readAsRoleHolder(kind, () => readOwnSaisons(kind));
  if (saisons !== null) redirect(PLACE[kind].overview.path(saisons.standard));
  return {
    tone: "info",
    title: COPY.shared.end.noSaison,
    next: { label: COPY.shared.end.toAccount, href: ROUTES.account.path() },
  };
}
