/**
 * CORE · API response envelope
 *
 * Pure Zod, deliberately free of any server-only dependency: ten feature `schemas.ts` modules
 * value-import this envelope, so anything imported here is inherited by all of them. Keep it that way
 * — the reason it does not live in `api.ts` is on the export.
 */

import z from "zod";

/**
 * The envelope every FastAPI response carries.
 *
 * Deliberately **not** in `api.ts`, which starts with `import "server-only"`. Every feature
 * `schemas.ts` that extends this envelope value-imports it, so hosting it there taints ten schema
 * modules as server-only. Nothing in a client component may then import a runtime value from them
 * — an invariant currently held by an ESLint rule (`consistent-type-imports`) rather than by
 * structure, where a single missing `type` keyword becomes a build failure.
 *
 * This module is pure Zod with no server dependency, so extending the envelope costs nothing.
 *
 * Mirrors `BaseAPIResponse` in `fl_backend/app/shared/schemas/responses.py`, which declares
 * `acknowledged: Literal[0, 1] = 1` and nothing else. Failure bodies are a different shape entirely
 * — `{error_code, correlation_id}` (docs/logging.md) — and never reach a schema: `apiClient` throws
 * on any non-2xx before validation. On a success response the correlation id travels as the
 * `X-Correlation-ID` header, not in the body.
 */
// z.literal([0, 1]) is zod 4's shorthand for a union of literals — same output type and the same
// accept/reject behaviour as z.union([z.literal(0), z.literal(1)]), verified case by case.
export const BaseAPIResponseSchema = z.object({ acknowledged: z.literal([0, 1]) });
export type BaseAPIResponse = z.infer<typeof BaseAPIResponseSchema>;
