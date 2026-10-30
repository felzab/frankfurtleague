import z from "zod";

import type * as wire from "./generated/client/types";

// Every type here is imported from `fl_frontend/src/core/generated/client/types.ts` where it is used. What stays are
// two answers the hand-written calls hand `fl_frontend/src/core/api.ts :: apiClient`, which types the answer and parses
// nothing.

/**
 * Redesign: goes with its last importer, `fl_frontend/src/features/zustellung/schemas.ts`. The envelope a slice's
 * hand-written answer extends; the backend's answers carry no field of it.
 */
export const BaseAPIResponseSchema = z.object({});

/** Redesign: goes with its last importer, `fl_frontend/src/core/mailGate.ts`, and its `apiClient` call. */
export const FLGesperrtResponseSchema = z.custom<wire.FLGesperrtResponse>();
