import { createRef } from "react";

import type { DraftFormWiring } from "@/shared/hooks/useDraftFieldErrors.ts";

/** What a case rendering the shared `Form` without its draft hook hands it: no schemas and no refusal unless it names them. */
export function formWiring(parts: Partial<DraftFormWiring> = {}): DraftFormWiring {
  return { ref: createRef(), validationErrors: {}, schemas: [], ...parts };
}
