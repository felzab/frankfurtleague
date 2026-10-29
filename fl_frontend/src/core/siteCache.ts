/**
 * The one tag every `"use cache"` scope carries, which the save spines clear after every write that may stand: one tag
 * rather than one per resource, so no write has to know which cached reads it moves. A change no save makes, a
 * background pass's or a hand edit's, reaches the league's reads within the `minutes` lifetime they keep.
 */
export const SITE_CACHE_TAG = "site";
