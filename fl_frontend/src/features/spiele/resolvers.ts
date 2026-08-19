import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { NextPageProps } from "@/shared/types/types";

export function resolveSpielId(paramsPromise: NextPageProps<{ spiel_id: string }>["params"]): Promise<string> {
  return resolveObjectIdParam(paramsPromise, "spiel_id");
}
