import { z } from "zod";

import { KontaktEmailSchema } from "@/shared/schemas";

/**
 * Shared rather than private to the action: the form blocks its own submit against this, and a second copy of
 * the rule is how the browser comes to refuse what the server accepts (`docs/frontend/spec.md` I18).
 */
export const SignInPayloadSchema = z.object({
  // The rule `fl_frontend/src/core/config.ts :: ADMIN_EMAIL_ALLOWLIST` holds its entries to. This box
  // is the only route to a session, so an address the two judge differently locks its owner out.
  email: KontaktEmailSchema,
});
