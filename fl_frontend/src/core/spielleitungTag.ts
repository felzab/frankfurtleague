// A module of its own, as the other lanes' tags are (`fl_frontend/src/core/anmeldeTag.ts`): the send is
// `server-only`, and the reader is not.

/**
 * What every message to a referee about a fixture they officiate rides under, whatever
 * `fl_frontend/src/features/spielbestaetigungen/sweep.ts :: mailSpielleitung` sends: one recipient, one lane.
 */
export const SPIELLEITUNG_TAG = "spielleitung";

/** One value for every message: any missing tells the operator the same thing, a referee not told about their fixture. */
export const SPIELLEITUNG_HINWEIS = "hinweis";
