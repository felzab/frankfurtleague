import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { NextPageProps } from "@/shared/types/types";

export function resolveTeamId(paramsPromise: NextPageProps<{ team_id: string }>["params"]): Promise<string> {
  return resolveObjectIdParam(paramsPromise, "team_id");
}
