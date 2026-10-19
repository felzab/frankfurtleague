import "server-only";

import { mailOrigin } from "@/core/emailShell";

/** Under the segment `fl_frontend/src/app/robots.ts` already turns crawlers back from, so a live token is never indexed. */
export const SPIEL_BESTAETIGUNG_PATH = "/bestaetigung/spiel";

/**
 * The one place this link is spelled. `token` is the name `nginx/shared/http.conf :: $credential_free_uri`
 * redacts, and the origin goes through `mailOrigin` here, so the link and the message's close stand on one host.
 */
export function spielBestaetigungsLink(origin: string, token: string): string {
  return `${mailOrigin(origin)}${SPIEL_BESTAETIGUNG_PATH}?token=${encodeURIComponent(token)}`;
}
