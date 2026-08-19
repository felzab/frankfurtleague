import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { NextPageProps } from "@/shared/types/types";

export function resolveSpielerId(paramsPromise: NextPageProps<{ spieler_id: string }>["params"]): Promise<string> {
  return resolveObjectIdParam(paramsPromise, "spieler_id");
}
