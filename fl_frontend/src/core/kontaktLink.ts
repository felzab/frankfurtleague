// Outside `./kontaktEmail.ts`, which is server-only: an application's seat link is spelled on this
// path too, by modules a test reaches without the server's guard.
export const KONTAKT_BESTAETIGUNG_PATH = "/bestaetigung/kontakt";

/**
 * The one place a contact seat's link is spelled, an application's and a season row's alike.
 * `token` is the parameter name because `nginx/shared/http.conf :: $credential_free_uri` matches that
 * name; a second spelling reaches the access line and the referer unredacted.
 */
export function kontaktBestaetigungsLink(origin: string, token: string): string {
  return `${origin}${KONTAKT_BESTAETIGUNG_PATH}?token=${encodeURIComponent(token)}`;
}
