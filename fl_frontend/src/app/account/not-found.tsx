import { RailColumn } from "@/kit/RailFrame";
import { StatusPage } from "@/kit/StatusPage";

import { SERVER_COPY } from "@/core/serverCopy";

import { ACCOUNT_HOME } from "./entries";

/**
 * An address Konto does not hold, in the rail frame: this boundary stands inside the frame's layout and replaces the
 * route group's column with the page, so it draws the phone's band itself.
 */
export default function AccountNotFound() {
  return (
    <RailColumn back={ACCOUNT_HOME.href}>
      <StatusPage
        frame="rail"
        scope="area"
        title={SERVER_COPY.landing.notFound}
        card={{ tone: "info", next: ACCOUNT_HOME }}
      />
    </RailColumn>
  );
}
