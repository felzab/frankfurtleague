import { z } from "zod";

import { KontaktEmailSchema } from "@/shared/schemas";

/**
 * Shared rather than private to the action: the form blocks its own submit against this, and a second copy of
 * the rule is how the browser comes to refuse what the server accepts (`docs/frontend/spec.md` I18).
 */
export const SignInPayloadSchema = z.object({
  // This box is the only route to a session, so a grant made to an address it refuses admits nobody.
  email: KontaktEmailSchema,
});
