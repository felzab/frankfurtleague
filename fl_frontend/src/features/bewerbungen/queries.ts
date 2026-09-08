import { cache } from "react";

import z from "zod";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { bewerbungenQueueStatus } from "./facets";
import { postEinwilligungAnsicht } from "./mutations";
import {
  FLBewerbungenListResponseSchema,
  FLBewerbungFensterResponseSchema,
  FLBewerbungKeinFensterResponseSchema,
  FLBewerbungKuerzelResponseSchema,
  FLBewerbungSchulenResponseSchema,
  FLBewerbungSingleResponseSchema,
  FLBewerbungTrikotFarbenResponseSchema,
} from "./schemas";
import { mapEinwilligungAnsichtRefusal } from "./utils";

import type {
  FLBewerbungenListResponse,
  FLBewerbungFensterResponse,
  FLBewerbungKeinFensterResponse,
  FLBewerbungKuerzelResponse,
  FLBewerbungSchulenResponse,
  FLBewerbungSingleResponse,
  FLBewerbungTrikotFarbenResponse,
} from "./schemas";
import type { EinwilligungAnsicht, FLBewerbungenFilterParams } from "./types";

/**
 * Every application, newest first, narrowable by season and by any number of statuses.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not caller identity, so a
 * cached read of this admin-tier personal data is a shared slot.
 */
export async function getBewerbungen(filters: FLBewerbungenFilterParams = {}): Promise<FLBewerbungenListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runWithIncomingTrace(() =>
    apiClient<FLBewerbungenListResponse>("/bewerbungen", FLBewerbungenListResponseSchema, {
      authType: "admin",
      params: filters,
    }),
  );
}

/**
 * The queue as one route's query string selects it. Here rather than at the page: a facet carries a `read`
 * function, which a Server Component may not pass on
 * (`fl_frontend/src/shared/utils/facets.test.ts :: who may hold a facet`).
 */
export async function getBewerbungenQueue(
  params: Readonly<Record<string, string | string[] | undefined>>,
  order: "asc" | "desc",
): Promise<FLBewerbungenListResponse> {
  return getBewerbungen({ order: order, status: bewerbungenQueueStatus(params) });
}

/**
 * The one application the triage page decides against, uncached for the reason above. `null` on a
 * 404, which the page turns into `notFound()`; everything else throws.
 */
// `cache` memoizes per RENDER PASS, never `"use cache"`, which keys on the arguments (`docs/frontend/spec.md` §1.2).
export const getBewerbungById = cache(async (bewerbungId: string): Promise<FLBewerbungSingleResponse | null> =>
  runWithIncomingTrace(() =>
    apiClient<FLBewerbungSingleResponse>(`/bewerbungen/${encodeURIComponent(bewerbungId)}`, FLBewerbungSingleResponseSchema, {
      authType: "admin",
    }).catch((error: unknown) => {
      if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
      throw error;
    }),
  ),
);

/**
 * The season whose application window is running right now, or `null` where none is.
 *
 * Uncached for its own reason: `laeuft` is a judgement against today, so a cached answer would go
 * on inviting applications after the window shut.
 */
export async function getOffenesBewerbungFenster(): Promise<FLBewerbungFensterResponse | null> {
  return runWithIncomingTrace(() =>
    // `base`, spelled out beside the admin reads above: this endpoint is the public tier's, and an
    // over-declared tier succeeds silently.
    apiClient<FLBewerbungFensterResponse>("/bewerbungen/fenster", FLBewerbungFensterResponseSchema, { authType: "base" }).catch(
      (error: unknown) => {
        // 404 is "no season is taking applications", which is a state and not a failure.
        if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
        throw error;
      },
    ),
  );
}

// The two bodies `GET /bewerbungen/fenster/{saison_id}` answers, told apart by a key rather than by
// parse order: a member swallowing a malformed window would read as a season with no deadline.
const FensterAntwortSchema = z.union([FLBewerbungFensterResponseSchema, FLBewerbungKeinFensterResponseSchema]);

/**
 * One season's window, `null` where that season records none — and `null` for the whole answer where
 * no season carries the id, which is the page's `notFound()`.
 */
// `cache`, never `"use cache"`: the metadata and the body read this once between them, and a cache
// would key on the season and go on serving `laeuft` after the window shut (`docs/frontend/spec.md` §1.2).
export const getBewerbungFenster = cache(async (saisonId: string): Promise<{ fenster: FLBewerbungFensterResponse | null } | null> =>
  runWithIncomingTrace(() =>
    apiClient<FLBewerbungFensterResponse | FLBewerbungKeinFensterResponse>(
      `/bewerbungen/fenster/${encodeURIComponent(saisonId)}`,
      FensterAntwortSchema,
      { authType: "base" },
    )
      .then((antwort) => ("fenster" in antwort ? { fenster: null } : { fenster: antwort }))
      .catch((error: unknown) => {
        if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
        throw error;
      }),
  ),
);

/** The clubs a school picks itself out of, name and id alone, in the order the picker offers them. */
export async function getBewerbungSchulen(): Promise<FLBewerbungSchulenResponse> {
  return runWithIncomingTrace(() =>
    apiClient<FLBewerbungSchulenResponse>("/bewerbungen/schulen", FLBewerbungSchulenResponseSchema, { authType: "base" }),
  );
}

/**
 * Which colours one season has ASSIGNED — `saison_teams.trikot_farbe`, never a wish. Uncached for
 * `getBewerbungKuerzel`'s reason: one is assigned between two page loads, and a cached "still
 * free" outlives that.
 */
export async function getBewerbungTrikotfarben(saisonId: string): Promise<FLBewerbungTrikotFarbenResponse> {
  return runWithIncomingTrace(() =>
    apiClient<FLBewerbungTrikotFarbenResponse>(
      `/bewerbungen/trikotfarben/${encodeURIComponent(saisonId)}`,
      FLBewerbungTrikotFarbenResponseSchema,
      { authType: "base" },
    ),
  );
}

/**
 * One link's standing, read on every open and stored nowhere: a GET records nothing, not even a
 * visit, because mail scanners fetch every link in a message.
 */
export async function getEinwilligungAnsicht(token: string): Promise<EinwilligungAnsicht> {
  return runWithIncomingTrace(() =>
    postEinwilligungAnsicht({ token: token }).then(
      // Narrowed here and never at the page, which would carry the name in its payload regardless:
      // a dead link's panel names nobody, and an open link with no name left has nobody to name.
      (ansicht) =>
        ansicht.zustand === "gueltig"
          ? ansicht.vorname === null
            ? { zustand: "ungueltig" as const }
            : { zustand: "gueltig" as const, ansicht: { ...ansicht, vorname: ansicht.vorname } }
          : { zustand: ansicht.zustand },
      (error: unknown) => {
        // Anything but a refusal is a failed read, which is the page's own state rather than a panel
        // calling a live link void.
        const zustand = mapEinwilligungAnsichtRefusal(error);
        if (zustand !== null) return { zustand: zustand };
        throw error;
      },
    ),
  );
}

/** Whether a two-letter code already belongs to a club, in one neutral answer that names none. */
export async function getBewerbungKuerzel(shorthand: string): Promise<FLBewerbungKuerzelResponse> {
  return runWithIncomingTrace(() =>
    apiClient<FLBewerbungKuerzelResponse>(`/bewerbungen/kuerzel/${encodeURIComponent(shorthand)}`, FLBewerbungKuerzelResponseSchema, {
      authType: "base",
    }),
  );
}
