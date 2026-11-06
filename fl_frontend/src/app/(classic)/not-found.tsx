import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

/**
 * A record a classic page's address names and the league does not hold, inside the frame
 * `fl_frontend/src/app/(classic)/layout.tsx` drew. The root's not-found page stands above that layout and draws no
 * frame, so the throw is answered here.
 */
export default function ClassicNotFound() {
  return (
    <StatusPage
      frame="classic"
      tone="info"
      title={SERVER_COPY.notFound}
      next={{ label: COPY.shared.end.toHome, href: ROUTES.home.path() }}
    />
  );
}
