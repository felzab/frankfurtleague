import { frontend_config } from "./config";

export const ANMELDE_BESTAETIGEN_PATH = "/signin/bestaetigen";

/**
 * The one place the sign-in link is spelled. `token` is the parameter name because
 * `nginx/prod.conf :: $credential_free_uri` redacts that name; a second spelling reaches the access
 * line and the referer unredacted.
 */
export function buildAnmeldeLink(token: string): string {
  // The configured origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
  // production must not mail production links (`docs/frontend/spec.md :: I186`).
  return `${new URL(frontend_config.AUTH_URL).origin}${ANMELDE_BESTAETIGEN_PATH}?token=${encodeURIComponent(token)}`;
}
