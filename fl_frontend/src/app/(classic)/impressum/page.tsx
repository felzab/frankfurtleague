import { ClassicPage, ClassicTitle } from "@/kit/ClassicPage";
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

/** The Impressum under § 5 DDG: who provides the site, who represents it, how to reach it, its register entry and its licence. */
export default function LegalNoticePage() {
  const { provider, representation, contact, register, licence } = words;
  return (
    <ClassicPage width="form">
      <ClassicTitle text={COPY.page.legalNotice} />
      <Prose
        blocks={[
          { kind: "heading", text: provider.heading },
          { kind: "paragraph", text: [provider.name] },
          { kind: "paragraph", text: [provider.address] },
          { kind: "heading", text: representation.heading },
          { kind: "paragraph", text: [representation.rule] },
          { kind: "list", items: VORSTAND.map((member) => [representation.member(member.name, member.amt)]) },
          { kind: "heading", text: contact.heading },
          { kind: "paragraph", text: [contact.lead, { href: KONTAKT_MAILTO, label: { record: KONTAKT_EMAIL } }] },
          { kind: "heading", text: register.heading },
          { kind: "paragraph", text: [register.entry] },
          { kind: "heading", text: licence.heading },
          { kind: "paragraph", text: [licence.lead, { href: SOURCE_URL, label: licence.link }] },
        ]}
      />
    </ClassicPage>
  );
}
