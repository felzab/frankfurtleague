import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

/**
 * A record a classic page's address names and the league does not hold, inside the frame
 * `fl_frontend/src/app/(classic)/layout.tsx` drew. Next inserts no boundary of its own for a first-level group beside
 * a root not-found page, so without this file the throw reaches the root's, above that layout, and the frame goes.
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
