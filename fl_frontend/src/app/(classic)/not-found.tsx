import { SERVER_COPY } from "@/core/serverCopy";
import { TO_HOME } from "@/kit/mailedLinkState";
import { ClassicStatusPage } from "@/kit/StatusCard";

/**
 * A record a classic page's address names and the league does not hold, inside the frame its layout drew. The root's
 * not-found page stands above that layout and draws no frame, so the throw is answered here.
 */
export default function ClassicNotFound() {
  return (
    <ClassicStatusPage
      tone="info"
      title={SERVER_COPY.notFound}
      next={TO_HOME}
    />
  );
}
