/**
 * The one tag every `"use cache"` scope carries: one tag rather than one per resource, so no write has to know which
 * cached reads it moves. The action builder (`fl_frontend/src/core/action.ts :: action`) clears it at the end of an
 * action exactly when the action's body sent a backend write that may have landed, and renders the page again
 * without clearing it where the body sent none; the old write path's spines clear it after a write that may stand. A
 * change no save makes, a background pass's or a hand edit's, reaches the league's reads within the `minutes`
 * lifetime they keep.
 */
export const SITE_CACHE_TAG = "site";
