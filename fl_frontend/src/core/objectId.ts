/**
 * `core` for `fl_frontend/src/core/emailAddress.ts`'s reason: `eslint.config.mjs :: LAYER_BOUNDARY`
 * refuses `core` an import from `shared`, so a read model declared here could not otherwise validate
 * the id shape its siblings validate.
 */

import z from "zod";

// Named rather than written into the schema below.
const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

// No message of its own: an id comes from a read, never from typing, so a malformed one is the German error
// map's unexpected line, which a message here would outrank.
export const CustomObjectIdStringSchema = z.string().regex(OBJECT_ID_REGEX);
