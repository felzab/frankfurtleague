import { cache } from "react";

import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";
import { runWithIncomingCorrelationId } from "@/shared/utils/correlationScope";

import {
  FLBewerbungenListResponseSchema,
  FLBewerbungFensterResponseSchema,
  FLBewerbungKuerzelResponseSchema,
  FLBewerbungSchulenResponseSchema,
  FLBewerbungSingleResponseSchema,
} from "./schemas";

import type {
  FLBewerbungenListResponse,
  FLBewerbungFensterResponse,
  FLBewerbungKuerzelResponse,
  FLBewerbungSchulenResponse,
  FLBewerbungSingleResponse,
} from "./schemas";
import type { FLBewerbungenFilterParams } from "./types";

/**
 * Every application, newest first, narrowable by season and by status.
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not caller identity, so a
 * cached read of this admin-tier personal data is a shared slot.
 */
export async function getBewerbungen(filters: FLBewerbungenFilterParams = {}): Promise<FLBewerbungenListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runWithIncomingCorrelationId(() =>
    apiClient<FLBewerbungenListResponse>("/bewerbungen", FLBewerbungenListResponseSchema, {
      authType: "admin",
      params: filters,
    }),
  );
}

/**
 * The one application the triage page decides against, uncached for the reason above. `null` on a
 * 404, which the page turns into `notFound()`; everything else throws.
 */
// React's `cache` memoizes per RENDER PASS, never across requests -- unlike `"use cache"`, whose key
// is the arguments, not the caller. One pass, one round trip.
export const getBewerbungById = cache(async (bewerbungId: string): Promise<FLBewerbungSingleResponse | null> =>
  runWithIncomingCorrelationId(() =>
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
  return runWithIncomingCorrelationId(() =>
    // `base`, spelled out beside the admin reads above: this endpoint is the public tier's, and an
    // over-declared tier succeeds silently (`OPS-87`).
    apiClient<FLBewerbungFensterResponse>("/bewerbungen/fenster", FLBewerbungFensterResponseSchema, { authType: "base" }).catch(
      (error: unknown) => {
        // 404 is "no season is taking applications", which is a state and not a failure.
        if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
        throw error;
      },
    ),
  );
}

/**
 * One season's window, or `null` where that season takes no applications at all. The whole of what
 * the public page may read about its own season: `docs/backend/spec.md :: I47` withholds the rest.
 */
export async function getBewerbungFenster(saisonId: string): Promise<FLBewerbungFensterResponse | null> {
  return runWithIncomingCorrelationId(() =>
    apiClient<FLBewerbungFensterResponse>(`/bewerbungen/fenster/${encodeURIComponent(saisonId)}`, FLBewerbungFensterResponseSchema, {
      authType: "base",
    }).catch((error: unknown) => {
      if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
      throw error;
    }),
  );
}

/** The clubs a school picks itself out of, name and id alone, in the order the picker offers them. */
export async function getBewerbungSchulen(): Promise<FLBewerbungSchulenResponse> {
  return runWithIncomingCorrelationId(() =>
    apiClient<FLBewerbungSchulenResponse>("/bewerbungen/schulen", FLBewerbungSchulenResponseSchema, { authType: "base" }),
  );
}

/**
 * Whether a two-letter code already belongs to a club. ONE neutral answer: it separates no active
 * club from a retired one and names none, this check being open to anybody who opens the form.
 */
export async function getBewerbungKuerzel(shorthand: string): Promise<FLBewerbungKuerzelResponse> {
  return runWithIncomingCorrelationId(() =>
    apiClient<FLBewerbungKuerzelResponse>(`/bewerbungen/kuerzel/${encodeURIComponent(shorthand)}`, FLBewerbungKuerzelResponseSchema, {
      authType: "base",
    }),
  );
}
