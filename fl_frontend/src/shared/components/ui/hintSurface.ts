/**
 * SHARED · hint surface
 *
 * The one appearance for a short explanatory overlay: `IconTooltip`'s tooltip and `DisabledHint`'s
 * popover. The two mechanisms differ because touch forces it, and a reader hovering an admin table
 * should not be able to tell which of them answered.
 *
 * Invariants:
 * - The ink is the call site's, so `IconTooltip` can carry its danger tone; everything else is here.
 * - HeroUI's `break-all` splits a word mid-token, wrong for prose. `[word-break:normal]` and
 *   `wrap-break-word` write one property each, so no reorder decides between them.
 */

/** Centred, which is every hint in the app: the labels are one short line and the sentences are two. */
export const HINT_SURFACE =
  "bg-surface border-border fluid-xs w-max max-w-72 rounded-md border px-2.5 py-1 text-center text-balance wrap-break-word [word-break:normal] shadow-lg outline-none";
