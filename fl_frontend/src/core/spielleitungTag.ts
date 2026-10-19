// A module of its own, as the other lanes' tags are (`fl_frontend/src/core/anmeldeTag.ts`): the send is
// `server-only`, and the reader is not.

/**
 * What a referee's word about a fixture they officiate rides under, the booking and the notice that the fixture moved
 * alike: one recipient, one lane.
 */
export const SPIELLEITUNG_TAG = "spielleitung";

/** One value for both messages: either missing tells the operator the same thing, a referee not told about their fixture. */
export const SPIELLEITUNG_HINWEIS = "hinweis";
