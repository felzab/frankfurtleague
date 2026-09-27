// A module of its own, as the sign-in lane's tag is (`fl_frontend/src/core/anmeldeTag.ts`): the send is
// `server-only`, and the reader is not.

/** What a notice of a change to who administers rides under, so a delivery event about it is told apart. */
export const BERECHTIGUNG_TAG = "berechtigung";

/** One kind of message goes out on this lane, and its outbox row is gone once stamped, so the value names the lane. */
export const BERECHTIGUNG_HINWEIS = "hinweis";
