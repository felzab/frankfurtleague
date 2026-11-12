import "server-only";

import { ROUTES } from "@/core/routes";
import { readOwnSaisons } from "@/features/roles/queries";
import { readAsRoleHolder, requireRole } from "@/features/roles/resolvers";

import type { PersonKind } from "@/features/roles/queries";

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
 * The season a place's address without a season draws its Übersicht in, the one the frame's season button stands on
 * by standard; `null` while the person's records stand in no season. A person holding no such Funktion is sent on
 * before. The seasons are the frame's own read, so they cost the page no request of its own.
 */
export async function standardSaison(kind: PersonKind): Promise<string | null> {
  await requireRole(kind, PLACE[kind].area.path());
  const saisons = await readAsRoleHolder(kind, () => readOwnSaisons(kind));
  return saisons?.standard ?? null;
}
