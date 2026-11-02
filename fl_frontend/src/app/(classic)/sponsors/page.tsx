import { ClassicPage, ClassicTitle } from "@/kit/ClassicPage";
import { SponsorTiles } from "@/kit/TileGrid";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { SPONSORS } from "@/features/meta/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.sponsors, ROUTES.sponsors.path(), { description: SERVER_COPY.description.sponsors });
}

/** The sponsors page (D266, D278, D280): each sponsor an equal tile, its logo over its short name, linking to its site. */
export default function SponsorsPage() {
  return (
    <ClassicPage width="form">
      <ClassicTitle text={COPY.page.sponsors} />
      <SponsorTiles sponsors={SPONSORS} />
    </ClassicPage>
  );
}
