import { MAILED_PAGE_METADATA } from "@/kit/MailedPage";
import { StatusPage } from "@/kit/StatusPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

/** A row no crawler fetches, as the deletion link's page beside it. */
export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  const row = ROUTES.accountErased;
  return { ...(await pageMetadata(parent, row, row.path())), ...MAILED_PAGE_METADATA };
}

/**
 * `/erasure/done`, the deletion's done state: the page the deletion's action leads to once the account and its
 * session are gone, reading nothing, so it renders under no session at all.
 */
export default function AccountErasedPage() {
  return (
    <StatusPage
      frame="classic"
      tone="success"
      title={SERVER_COPY.accountErasure.done}
      sentence={SERVER_COPY.accountErasure.doneSentence}
      next={{ label: COPY.shared.end.toHome, href: ROUTES.home.path() }}
    />
  );
}
