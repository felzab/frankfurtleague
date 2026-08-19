import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { NextPageProps } from "@/shared/types/types";

export function resolveSpielortId(paramsPromise: NextPageProps<{ spielort_id: string }>["params"]): Promise<string> {
  return resolveObjectIdParam(paramsPromise, "spielort_id");
}
