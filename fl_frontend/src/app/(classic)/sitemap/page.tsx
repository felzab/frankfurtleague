import { connection } from "next/server";

import { ClassicPage, ClassicTitle } from "@/kit/ClassicPage";
import { PageWait } from "@/kit/PageFade";
import { Prose, ProseLinksPlaceholder } from "@/kit/Prose";
import { SAISON_WORDS } from "@/kit/Skeleton";

import { COPY } from "@/core/copy";
import { ROUTES, SAISONLESS_PAGES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getSaisonFrame } from "@/features/saisons/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { LEGAL_LINKS, LIGA_LINKS } from "../frame";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.sitemap, ROUTES.sitemap.path(), { description: SERVER_COPY.description.sitemap });
}

/** Every season the public may read, the newest first, each with its pages. Read on a request: the build reaches no backend. */
async function SaisonGroups() {
  await connection();
  const { saisons } = await getSaisonFrame();
  if (saisons.length === 0) return null;
  return (
    <Prose
      blocks={saisons.flatMap(({ id }) => [
        { kind: "heading", text: COPY.shared.saisonName(id) },
        { kind: "links", links: SAISONLESS_PAGES.map(({ page }) => ({ label: ROUTES[page].title, href: ROUTES[page].path(id) })) },
      ])}
    />
  );
}

/**
 * Every public page in the footer's groups, for a person looking for one. The season's pages wait for the read naming
 * the seasons, the groups below them standing at once, the column's gap the one the headings keep inside `Prose`.
 */
export default function SitemapPage() {
  return (
    <ClassicPage width="form">
      <ClassicTitle text={COPY.page.sitemap} />
      <PageWait
        fallback={
          <ProseLinksPlaceholder
            heading={SAISON_WORDS}
            links={SAISONLESS_PAGES.map(({ page }) => ROUTES[page].title)}
          />
        }>
        <SaisonGroups />
      </PageWait>
      <Prose
        blocks={[
          { kind: "heading", text: COPY.template.liga },
          { kind: "links", links: LIGA_LINKS },
          { kind: "heading", text: COPY.template.legal },
          { kind: "links", links: LEGAL_LINKS },
        ]}
      />
    </ClassicPage>
  );
}
