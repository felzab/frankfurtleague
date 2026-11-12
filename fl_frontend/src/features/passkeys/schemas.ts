import { z } from "zod";

/**
 * The name a holder gives a passkey. A bound nobody else sets: the plugin takes any non-empty string, and the name is
 * drawn in a row and in the browser's own prompt, where a longer one breaks both.
 */
export const PASSKEY_NAME_MAX = 50;

/** The rename's one field, whose German the action's error map words. */
export const PasskeyNameSchema = z.string().min(1).max(PASSKEY_NAME_MAX);
