import { SpielPopupEnd } from "@/kit/SpielHead";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

/**
 * A pop-up whose match is not there, its id malformed or its season withheld: a match row pressed after its match was
 * deleted reaches it, as a crafted address does. A segment's not-found boundary wraps its `children` alone, so the
 * root's not-found page never catches a throw inside this slot; this file is the slot's own boundary, and draws the
 * root not-found's card, its words and its way on, in the pop-up's dialog over the page the row was pressed on, so a
 * missing match opens where a found one does. A reload of the address renders the season route, whose own not-found
 * page answers.
 */
export default function NoPopupFound() {
  return (
    <SpielPopupEnd
      beneath={ROUTES.saisons.path()}
      tone="info"
      title={SERVER_COPY.notFound}
      next={{ label: COPY.shared.end.toHome, href: ROUTES.home.path() }}
    />
  );
}
