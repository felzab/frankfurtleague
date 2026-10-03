import { z } from "zod";

/**
 * The name a holder gives a passkey. A bound nobody else sets: the plugin takes any non-empty string,
 * and the name is drawn on a card and in the sign-in list, where a longer one breaks both.
 */
export const PASSKEY_NAME_MAX = 50;

/**
 * Shared rather than private to the action: the card's form blocks its own submit against this, and a
 * second copy of the rule is how the browser comes to refuse what the server accepts (`docs/frontend/spec.md` I18).
 */
export const PasskeyNamePayloadSchema = z.object({
  name: z
    .string()
    .trim()
    .nonempty({ error: "Bitte gib einen Namen ein." })
    .max(PASSKEY_NAME_MAX, { error: `Der Name darf höchstens ${String(PASSKEY_NAME_MAX)} Zeichen lang sein.` }),
});
