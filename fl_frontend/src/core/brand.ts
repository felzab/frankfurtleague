/**
 * CORE · site identity constants
 *
 * The contact address the site publishes, declared once. The Kontakt page's channel list and the
 * error page's report link both build a `mailto:` from it — two spellings would drift exactly where
 * a working address matters most, on the page a visitor reaches when something already broke.
 * In `core` rather than `shared` for the layering: `shared/components/ui/Error.tsx` consumes it,
 * and `shared` may reach into `core` but never into a feature slice.
 */

export const KONTAKT_EMAIL = "kontakt@frankfurt-league.de";
