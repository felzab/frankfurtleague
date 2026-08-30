import { z } from "zod";

/**
 * Shared rather than private to the action: the form blocks its own submit against this, and a second copy of
 * the rule is how the browser comes to refuse what the server accepts (`docs/frontend/spec.md` I18).
 */
export const SignInPayloadSchema = z.object({
  email: z.email("Bitte gib eine gültige E-Mail-Adresse ein."),
});
