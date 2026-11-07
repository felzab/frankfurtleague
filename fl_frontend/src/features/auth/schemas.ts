import { z } from "zod";

import { asSignInIdentifier, isDeliverableAddress, KONTAKT_EMAIL_MAX_LENGTH } from "@/core/emailAddress";
import { isSignInLibraryAddress } from "@/core/signInLibraryAddress";

/**
 * The address the send and the code step both take: one rule, so a code is never typed for an address the send
 * refused. `KontaktEmailSchema`'s rule without its sentences, so `fl_frontend/src/core/action.ts :: parsed` words
 * every refusal on the box through the German map: a schema's own message is past the map, and answers the
 * unexpected line. The browser's `type=email` takes addresses this refuses, a host with no dot among them, so this
 * answer is the one such an address meets.
 */
export const SignInPayloadSchema = z.object({
  email: z
    .string()
    // Pydantic strips before it validates, so a pasted trailing space is an address the API takes.
    .trim()
    // Ahead and ending the judgement, as on `KontaktEmailSchema`: the ceiling is a line of its own.
    .max(KONTAKT_EMAIL_MAX_LENGTH, { abort: true })
    // The ASCII local part and the special-use domains are in this predicate too, each worded alike here.
    .refine(isDeliverableAddress),
});

/**
 * An address a person will sign in at: the box's rule and the sign-in library's own. The API takes addresses the library
 * refuses, and at such an address the sign-in answers as sent and no code ever comes, so a grant there admits nobody and
 * a change onto it locks its person out. A ban and an erasure name an address that may already stand on file, and keep
 * the box's rule.
 */
export const SignInAddressSchema = SignInPayloadSchema.shape.email.refine((email) => isSignInLibraryAddress(asSignInIdentifier(email)));
