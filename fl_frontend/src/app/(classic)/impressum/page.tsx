import { ClassicPage, PageHead } from "@/kit/ClassicPage";
import { Prose } from "@/kit/Prose";

import { KONTAKT_EMAIL, KONTAKT_MAILTO, SOURCE_URL, VORSTAND } from "@/core/brand";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

const words = SERVER_COPY.legal.legalNotice;

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.legalNotice, ROUTES.legalNotice.path(), { description: SERVER_COPY.description.legalNotice });
}

/**
 * The Impressum under § 5 DDG: who provides the site, who represents it, how to reach it, its register entry and its
 * licence. A plain centred page, five short sections needing no contents list.
 */
export default function LegalNoticePage() {
  const { provider, representation, contact, register, licence } = words;
  return (
    <ClassicPage width="form">
      <PageHead
        title={COPY.page.legalNotice}
        lead={[SERVER_COPY.description.legalNotice]}
      />
      <Prose
        sections={[
          {
            heading: provider.heading,
            blocks: [
              { kind: "paragraph", text: [provider.name] },
              { kind: "paragraph", text: [provider.address] },
            ],
          },
          {
            heading: representation.heading,
            blocks: [
              { kind: "paragraph", text: [representation.rule] },
              { kind: "list", items: VORSTAND.map((member) => [representation.member(member.name, member.amt)]) },
            ],
          },
          {
            heading: contact.heading,
            blocks: [{ kind: "paragraph", text: [contact.lead, { href: KONTAKT_MAILTO, label: { record: KONTAKT_EMAIL } }] }],
          },
          { heading: register.heading, blocks: [{ kind: "paragraph", text: [register.entry] }] },
          { heading: licence.heading, blocks: [{ kind: "paragraph", text: [licence.lead, { href: SOURCE_URL, label: licence.link }] }] },
        ]}
      />
    </ClassicPage>
  );
}
