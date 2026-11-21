import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { TO_HOME } from "@/kit/mailedLinkState";
import { ClassicStatusPage } from "@/kit/StatusCard";
import { pageMetadata } from "@/shared/utils/metadata";

// Titled by the card it draws, so the tab names the end the page shows rather than the act that led there.
export const metadata = pageMetadata(ROUTES.accountErased, { title: SERVER_COPY.accountErasure.done });

/**
 * `/erasure/done`, the deletion's done state: the page the deletion's action leads to once the account and its
 * session are gone, reading nothing, so it renders under no session at all.
 */
export default function AccountErasedPage() {
  return (
    <ClassicStatusPage
      tone="success"
      title={SERVER_COPY.accountErasure.done}
      next={TO_HOME}
      // What outlives the deletion is the notice's to list.
      quiet={{ label: ROUTES.privacyNotice.title, href: ROUTES.privacyNotice.path() }}
    />
  );
}
