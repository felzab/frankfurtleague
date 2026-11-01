/**
 * The one tag every `"use cache"` scope carries: one tag rather than one per resource, so no write has to know which
 * cached reads it moves. The action builder (`fl_frontend/src/core/action.ts :: action`) clears it at the end of an
 * action exactly when the action's body sent a backend write that may have landed: sent, and not refused by its own
 * answer (`fl_frontend/src/core/apiDispatch.ts :: dispatchRequest`). An action that sent none carries only its answer
 * and renders no page again, and one changing state outside the cache, the sign-in store's, calls `refresh()` itself.
 * The old write path's spines clear it after a write that may stand. A write behind the response clears nothing. A
 * change no save makes, a background pass's or a hand edit's, reaches the league's reads within the `minutes`
 * lifetime they keep.
 */
export const SITE_CACHE_TAG = "site";
