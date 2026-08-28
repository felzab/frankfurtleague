import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { NextPageProps } from "@/shared/types/types";

export function resolveBewerbungId(paramsPromise: NextPageProps<{ bewerbung_id: string }>["params"]): Promise<string> {
  return resolveObjectIdParam(paramsPromise, "bewerbung_id");
}
