import { connection } from "next/server";

import { ClassicPage, PageHead } from "@/kit/ClassicPage";
import { ProseOnceRead } from "@/kit/Prose";

import { COPY } from "@/core/copy";
import { ROUTES, SAISONLESS_PAGES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getSaisonFrame } from "@/features/saisons/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { LEGAL_LINKS, LIGA_LINKS } from "../frame";

import type { ProseSection } from "@/kit/Prose";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.sitemap, ROUTES.sitemap.path(), { description: SERVER_COPY.description.sitemap });
}

/** The footer's groups, which stand under the seasons. */
const FRAME_GROUPS: ReadonlyArray<ProseSection> = [
  { heading: COPY.template.liga, blocks: [{ kind: "links", links: LIGA_LINKS }] },
  { heading: COPY.template.legal, blocks: [{ kind: "links", links: LEGAL_LINKS }] },
];

/**
 * Every season the public may read, the newest first, each with its pages, over the footer's groups. Read on a
 * request: the build reaches no backend.
 */
async function readGroups(): Promise<ReadonlyArray<ProseSection>> {
  await connection();
  const { saisons } = await getSaisonFrame();
  return [
    ...saisons.map(({ id }): ProseSection => ({
      heading: COPY.shared.saisonName(id),
      blocks: [{ kind: "links", links: SAISONLESS_PAGES.map(({ page }) => ({ label: ROUTES[page].title, href: ROUTES[page].path(id) })) }],
    })),
    ...FRAME_GROUPS,
  ];
}

/** Every public page in the footer's groups, for a person looking for one. */
export default function SitemapPage() {
  return (
    <ClassicPage width="form">
      <PageHead
        title={COPY.page.sitemap}
        lead={[SERVER_COPY.description.sitemap]}
      />
      <ProseOnceRead sections={readGroups()} />
    </ClassicPage>
  );
}
