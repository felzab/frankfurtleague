import z from "zod";

/**
 * The envelope every FastAPI response carries, mirroring the backend's `BaseAPIResponse`.
 *
 * Not in `api.ts`: that module is `server-only`, and every feature `schemas.ts` value-imports this
 * envelope, which would taint them all.
 */
export const BaseAPIResponseSchema = z.object({ acknowledged: z.literal([0, 1]) });
export type BaseAPIResponse = z.infer<typeof BaseAPIResponseSchema>;
