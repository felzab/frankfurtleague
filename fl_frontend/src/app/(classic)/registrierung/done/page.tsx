import { MAILED_PAGE_METADATA } from "@/kit/MailedPage";
import { ClassicStatusPage } from "@/kit/StatusCard";

import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { pageMetadata } from "@/shared/utils/metadata";

import { TO_HOME } from "../invitation";

import type { Metadata, ResolvingMetadata } from "next";

/** A row no crawler fetches, as the registration link's page beside it. */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.registrierungDone;
  return { ...(await pageMetadata(parent, row, row.path())), ...MAILED_PAGE_METADATA };
}

/**
 * `/registrierung/done`, a registration's done state: the page the submit leads to once the pupil's registration is
 * stored and the link forgotten, reading nothing, so a reload and the tab both say what happened rather than the
 * forgotten link's card.
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
