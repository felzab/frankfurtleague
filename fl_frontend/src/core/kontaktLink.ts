// Outside the contact mail's module, which is server-only: an application's seat link is spelled on this
// path too, by modules a test reaches without the server's guard.
import { ROUTES } from "./routes";

/**
 * The one place a contact seat's link is spelled, an application's and a season row's alike.
 * `token` is the parameter name because the edge's `$credential_free_uri` matches that name; a second
 * spelling reaches the access line and the referer unredacted.
 */
export function kontaktConfirmationLink(origin: string, token: string): string {
  return `${origin}${ROUTES.kontaktConfirmation.path()}?token=${encodeURIComponent(token)}`;
}
