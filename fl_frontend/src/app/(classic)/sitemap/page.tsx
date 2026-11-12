import { connection } from "next/server";

import { ClassicPage, PageHead } from "@/kit/ClassicPage";
import { PageWait } from "@/kit/PageFade";
import { Prose, ProseLinksPlaceholder } from "@/kit/Prose";
import { SAISON_WORDS } from "@/kit/Skeleton";

import { COPY } from "@/core/copy";
import { ROUTES, SAISONLESS_PAGES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getSaisonFrame } from "@/features/saisons/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { LEGAL_LINKS, LIGA_LINKS } from "../frame";

import type { ProseBlock } from "@/kit/Prose";
import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.sitemap, ROUTES.sitemap.path(), { description: SERVER_COPY.description.sitemap });
}

/** The footer's groups, which stand under the seasons. */
const FRAME_GROUPS: ReadonlyArray<ProseBlock> = [
  { kind: "heading", text: COPY.template.liga },
  { kind: "links", links: LIGA_LINKS },
  { kind: "heading", text: COPY.template.legal },
  { kind: "links", links: LEGAL_LINKS },
];

/**
 * Every season the public may read, the newest first, each with its pages, over the footer's groups: one text, so its
 * contents list names every group. Read on a request: the build reaches no backend.
 */
async function Groups() {
  await connection();
  const { saisons } = await getSaisonFrame();
  return (
    <Prose
      blocks={[
        ...saisons.flatMap(({ id }): ProseBlock[] => [
          { kind: "heading", text: COPY.shared.saisonName(id) },
          { kind: "links", links: SAISONLESS_PAGES.map(({ page }) => ({ label: ROUTES[page].title, href: ROUTES[page].path(id) })) },
        ]),
        ...FRAME_GROUPS,
      ]}
    />
  );
}

/**
 * Every public page in the footer's groups, for a person looking for one. The page waits for the read naming the
 * seasons, the groups below them landing with them in one reveal: the seasons are as many as the league has played, so
 * no wait can stand at their height, and groups standing below the wait would drop when more than its one arrive.
 */
export default function SitemapPage() {
  return (
    <ClassicPage width="reading">
      <PageHead
        title={COPY.page.sitemap}
        lead={[SERVER_COPY.description.sitemap]}
      />
      <PageWait
        fallback={
          <ProseLinksPlaceholder
            heading={SAISON_WORDS}
            links={SAISONLESS_PAGES.map(({ page }) => ROUTES[page].title)}
          />
        }>
        <Groups />
      </PageWait>
    </ClassicPage>
  );
}
