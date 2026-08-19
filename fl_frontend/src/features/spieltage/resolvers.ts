import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { NextPageProps } from "@/shared/types/types";

export function resolveSpieltagId(paramsPromise: NextPageProps<{ spieltag_id: string }>["params"]): Promise<string> {
  return resolveObjectIdParam(paramsPromise, "spieltag_id");
}
