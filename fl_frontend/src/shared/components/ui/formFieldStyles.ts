/**
 * The one text-field appearance (R4 §8.5). The style existed in two drifting copies across 12
 * fields: the four `AddressFields` had a brand-coloured focus border and the seven others had no
 * focus feedback at all — inside a single form, so a keyboard user saw the ring appear on
 * Straße/Nr./PLZ/Stadt and vanish on Name.
 *
 * `focus-visible:`, not `focus:`, so the border does not fire on pointer clicks — matching
 * `SignInForm`, which was the one field in the app already getting this right.
 */
export const FIELD_INPUT =
  "border-border bg-surface text-foreground text-fluid-sm focus-visible:border-brand focus-within:border-brand rounded-lg border px-3 py-2 transition-colors outline-none focus-visible:ring-0 focus-within:ring-0";
