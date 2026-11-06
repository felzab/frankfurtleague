import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";

/** A season or a record the public cannot read, or an address no page answers, in the rail frame its layout drew. */
export default function SaisonsNotFound() {
  return (
    <StatusPage
      frame="rail"
      scope="saison"
      title={SERVER_COPY.landing.notFound}
      card={{ tone: "info", next: { label: COPY.shared.end.toHome, href: ROUTES.home.path() } }}
    />
  );
}
