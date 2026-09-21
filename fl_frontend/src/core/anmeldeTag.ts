// A module of its own because neither end may import the other: the send is `server-only` and the
// reader reaches a client component.

/** What the sign-in mail rides under, so a delivery event about it is told from every other lane's. */
export const ANMELDUNG_TAG = "anmeldung";

/** One message goes out on this lane, so the value names the lane rather than a row to place it against. */
export const ANMELDUNG_LINK = "link";
