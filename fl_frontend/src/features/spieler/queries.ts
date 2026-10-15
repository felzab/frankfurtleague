import { cache } from "react";
import { cacheLife, cacheTag } from "next/cache";

import { apiClient } from "@/core/api";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { postSpielerAdresswechselAnsicht } from "./mutations";
import {
  FLKaderResponseSchema,
  FLSpielerListResponseSchema,
  FLSpielerMembershipsResponseSchema,
  FLSpielerNachnominierungResponseSchema,
  FLSpielerSelbstResponseSchema,
} from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type {
  FLKaderResponse,
  FLSpielerListResponse,
  FLSpielerMembershipsResponse,
  FLSpielerNachnominierungResponse,
  FLSpielerSelbstResponse,
} from "./schemas";
import type { FLSpielerFilterParams, SpielerAdresswechselAnsicht, SpielerAdresswechselZustand } from "./types";

export async function getSpieler(filters: FLSpielerFilterParams = {}): Promise<FLSpielerListResponse> {
  "use cache";

  // Base tag only — the squad page reads the running season by naming none, so a season tag would miss
  // the entry a squad save most often has to clear.
  cacheTag("spieler");

  // The consent record is an input here (`READ-PUPIL-003`) and no `spieler` write touches it: a
  // writer of a pupil's consent that drops no tag leaves a withdrawn name published for days.
  // `docs/frontend/spec.md :: I14` decides which call drops it.
  cacheLife("days");

  return apiClient<FLSpielerListResponse>("/spieler", FLSpielerListResponseSchema, {
    params: filters,
    cacheFill: { name: "getSpieler", args: filters },
  });
}

/**
 * `getSpieler` cannot serve the admin surfaces at any filter setting — backend spec I33 carries the
 * reasons.
 */
// Never `"use cache"` here, which keys on the arguments rather than the caller
// (`docs/frontend/spec.md` §1.2).
export const getSpielerMemberships = cache(async (): Promise<FLSpielerMembershipsResponse> =>
  runAdminRead(() =>
    apiClient<FLSpielerMembershipsResponse>("/spieler/memberships", FLSpielerMembershipsResponseSchema, { authType: "admin" }),
  ),
);

/** Whether the squad create would mark an entry into this season a Nachnominierung today. */
// Never `"use cache"`, for `getSpielerMemberships`' reason, and because the answer turns over at midnight.
export const getSpielerNachnominierung = cache(async (saisonId: string): Promise<FLSpielerNachnominierungResponse> =>
  runAdminRead(() =>
    apiClient<FLSpielerNachnominierungResponse>(`/spieler/nachnominierung/${saisonId}`, FLSpielerNachnominierungResponseSchema, {
      authType: "admin",
    }),
  ),
);

/**
 * One team's squad as its seat holder reads it, refused `REQ-FUNKTION-001` where the backend does not
 * find the seat the page's own check found.
 */
// Never `"use cache"`, for `getSpielerMemberships`' reason: what it answers is the reading person's.
export const getKader = cache(async (teamId: string, saisonId: string): Promise<FLKaderResponse> =>
  runPersonRead(() => apiClient<FLKaderResponse>(`/spieler/kader/${teamId}/${saisonId}`, FLKaderResponseSchema, { authType: "admin" })),
);

/**
 * The signed-in pupil's own record, refused `REQ-FUNKTION-001` where the backend holds no confirmed
 * pupil row for the address the page's own check passed.
 */
// Never `"use cache"`, for `getSpielerMemberships`' reason: what it answers is the reading person's.
export const getSpielerSelbst = cache(async (): Promise<FLSpielerSelbstResponse> =>
  runPersonRead(() => apiClient<FLSpielerSelbstResponse>("/spieler/selbst", FLSpielerSelbstResponseSchema, { authType: "admin" })),
);

/**
 * A refused address-link read as the panel it renders, or `null` where the read failed instead. Every
 * rule's refusal alike: a lapsed or barred link answers its state in a 200, so a refusal is a token
 * nothing could place.
 */
export function mapSpielerAdresswechselAnsichtRefusal(error: unknown): "ungueltig" | null {
  if (!isRefusal(error)) return null;

  // A token the backend will not parse matches no record, so the page calls the link void.
  if (error.serverErrorCode === "REQ-VAL-001") return "ungueltig";

  return isRuleRefusal(error) ? "ungueltig" : null;
}

/** What one address link opens, the referee's twin (`fl_frontend/src/features/schiedsrichter/queries.ts :: getSchiedsrichterAdresswechselAnsicht`). */
export async function getSpielerAdresswechselAnsicht(token: string): Promise<SpielerAdresswechselAnsicht> {
  return runWithIncomingTrace(() =>
    postSpielerAdresswechselAnsicht({ token: token }).then(
      (ansicht): SpielerAdresswechselAnsicht =>
        ansicht.zustand === "gueltig" ? { zustand: "gueltig", vorname: ansicht.vorname, frist: ansicht.frist } : { zustand: ansicht.zustand },
      (error: unknown): SpielerAdresswechselAnsicht => {
        // Anything but a refusal is a failed read, which is the page's own state rather than a panel
        // calling a live link void.
        const zustand = mapSpielerAdresswechselAnsichtRefusal(error);
        if (zustand !== null) return { zustand: zustand };
        throw error;
      },
    ),
  );
}

export type SpielerAdresswechselRefusal = {
  error?: string;
  fieldErrors?: FieldErrors;
  unplacedError?: string;
  zustand?: SpielerAdresswechselZustand;
};

/** A refused answer as the panel or the sentence the address page shows, or `null` where the code is none of these. */
export function mapSpielerAdresswechselRefusal(error: unknown): SpielerAdresswechselRefusal | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refused one is a drifted page, which the mail's link replaces.
    case "REQ-VAL-002":
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    case "REQ-SPIELER-001":
      return { zustand: "ungueltig" };
    case "REQ-SPIELER-002":
      return { zustand: "abgelaufen" };
    case "REQ-SPIELER-004":
      return { zustand: "gesperrt" };
    // The replaced address barred, or the new one taken by another pupil since the page opened, the
    // unique index answering a race the check missed: one panel, so the link's holder learns nothing
    // about who holds an address.
    case "REQ-SPIELER-005":
    case "REQ-SPIELER-006":
    case "DB-COMMON-002":
      return { zustand: "nicht_bestaetigbar" };
    default:
      return null;
  }
}
