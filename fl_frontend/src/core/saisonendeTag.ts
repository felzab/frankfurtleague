// A module of its own, as the other lanes' tags are (`fl_frontend/src/core/anmeldeTag.ts`): the send is
// `server-only`, and the reader is not.

/** What a pupil's season-end note rides under, so a delivery event about it is told from every other lane's. */
export const SAISONENDE_TAG = "saisonende";

/** One message goes out on this lane, and its registration is erased before it is sent, so the value names the lane. */
export const SAISONENDE_NOTIZ = "notiz";
