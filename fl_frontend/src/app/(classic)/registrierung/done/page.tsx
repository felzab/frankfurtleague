import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { TO_HOME } from "@/kit/mailedLinkState";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { pageMetadata } from "@/shared/utils/metadata";

// Titled by the card it draws, so the tab names the end the page shows rather than the form that led there.
export const metadata = pageMetadata(ROUTES.registrierungDone, { title: SERVER_COPY.registrierung.end.submitted });

/**
 * `/registrierung/done`, a registration's done state: the page the submit leads to once the pupil's registration is
 * stored and the link forgotten. It reads nothing and draws the submitted card, so a reload shows that card again
 * rather than the forgotten link's.
 */
export default function RegistrierungDonePage() {
  return (
    <ClassicStatusPage
      tone="info"
      title={SERVER_COPY.registrierung.end.submitted}
      next={TO_HOME}
    />
  );
}
