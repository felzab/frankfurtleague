import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { NextPageProps } from "@/shared/types/types";

export function resolveSchiedsrichterId(paramsPromise: NextPageProps<{ schiedsrichter_id: string }>["params"]): Promise<string> {
  return resolveObjectIdParam(paramsPromise, "schiedsrichter_id");
}
