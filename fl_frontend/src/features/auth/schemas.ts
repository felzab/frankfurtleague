import { z } from "zod";

import { isDeliverableAddress, KONTAKT_EMAIL_MAX_LENGTH } from "@/core/emailAddress";

/**
 * The address the send and the code step both take: one rule, so a code is never typed for an address the send
 * refused. `KontaktEmailSchema`'s rule without its sentences, so `fl_frontend/src/core/action.ts :: parsed` words
 * every refusal on the box through the German map: a schema's own message is past the map, and answers the
 * unexpected line. The browser's `type=email` takes addresses this refuses, a host with no dot among them, so this
 * answer is the one such an address meets.
 */
export const SignInPayloadSchema = z.object({
  // This box is the only route to a session, so a grant made to an address it refuses admits nobody.
  email: z
    .string()
    // Pydantic strips before it validates, so a pasted trailing space is an address the API takes.
    .trim()
    // Ahead and ending the judgement, as on `KontaktEmailSchema`: the ceiling is a line of its own.
    .max(KONTAKT_EMAIL_MAX_LENGTH, { abort: true })
    // The ASCII local part and the special-use domains are in this predicate too, each worded alike here.
    .refine(isDeliverableAddress),
});
