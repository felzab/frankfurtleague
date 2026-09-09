import { apiClient } from "@/core/api";
import { parseLeserichtung } from "@/shared/utils/leserichtung";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { aktionenLogFacetTerms } from "./facets";
import { FLAktionenListResponseSchema } from "./schemas";

import type { Leserichtung } from "@/shared/utils/leserichtung";
import type { FLAktionenListResponse } from "./schemas";

/** The single-row narrowings a row's own actions write, `null` where the URL names neither. */
export type AktionenLogSubjekt = { dokumentId: string | null; vorgangId: string | null };

// Anything but one plain value reads as no narrowing, so a hand-edited URL falls back to the whole
// log rather than 404ing — the rule the read order keeps too
// (`fl_frontend/src/shared/utils/leserichtung.ts :: parseLeserichtung`).
const einzeln = (value: string | string[] | undefined): string | null => (typeof value === "string" && value !== "" ? value : null);

/**
 * Uncached, as every admin-authed read is — `docs/frontend/spec.md` §1.2. Every filter is optional;
 * an omitted key means the whole log.
 */
export const getAktionen = async (
  // The bar's terms derived rather than respelled: a spread is exempt from the excess-property check,
  // so a term declared in `./facets` alone reaches the wire with nothing comparing it against the
  // published parameter (`fl_frontend/src/core/apiRequests.test.ts`).
  filters: ReturnType<typeof aktionenLogFacetTerms> & {
    trace_id?: string;
    document_id?: string;
    order?: Leserichtung;
  } = {},
): Promise<FLAktionenListResponse> => {
  return runWithIncomingTrace(() =>
    apiClient<FLAktionenListResponse>("/aktionen", FLAktionenListResponseSchema, {
      authType: "admin",
      params: filters,
    }),
  );
};

/**
 * Which one row's history the URL asks for. Read here as well as by `getAktionenLog`, so the notice
 * naming the narrowing and the request making it cannot disagree about one query string.
 */
export function readAktionenLogSubjekt(params: Readonly<Record<string, string | string[] | undefined>>): AktionenLogSubjekt {
  return { dokumentId: einzeln(params.document_id), vorgangId: einzeln(params.trace_id) };
}

/**
 * The log as one route's query string selects it. Here rather than at the page: a facet carries a `read`
 * function, which a Server Component may not import
 * (`fl_frontend/src/shared/utils/facets.test.ts :: who may hold a facet`).
 */
export async function getAktionenLog(params: Readonly<Record<string, string | string[] | undefined>>): Promise<FLAktionenListResponse> {
  const { dokumentId, vorgangId } = readAktionenLogSubjekt(params);

  return getAktionen({
    ...aktionenLogFacetTerms(params),
    // Narrowed by the endpoint rather than after the read: the cap runs before the narrowing, so a
    // search over the rows it left would miss one row's older history.
    trace_id: vorgangId ?? undefined,
    document_id: dokumentId ?? undefined,
    order: parseLeserichtung(params),
  });
}
