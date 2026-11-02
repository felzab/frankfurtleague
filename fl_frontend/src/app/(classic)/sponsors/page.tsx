import { ClassicPage, ClassicTitle } from "@/kit/ClassicPage";
import { Door } from "@/kit/Doors";
import { Link } from "@/kit/Link";
import { SponsorTiles } from "@/kit/TileGrid";

import { KONTAKT_EMAIL } from "@/core/brand";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { SPONSORS } from "@/features/meta/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata, Route } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return pageMetadata(parent, ROUTES.sponsors, ROUTES.sponsors.path(), { description: SERVER_COPY.description.sponsors });
}

/**
 * The sponsors page (D266, D278, D280): each sponsor an equal tile, its logo over its short name, linking to its
 * site; beneath, the door for whoever wants to support the league, its one act the league's address.
 */
export default function SponsorsPage() {
  const words = SERVER_COPY.landing;
  return (
    <ClassicPage width="form">
      <ClassicTitle text={COPY.page.sponsors} />
      <SponsorTiles sponsors={SPONSORS} />
      <Door
        title={words.doors.support}
        level={2}
        act={
          <Link
            href={`mailto:${KONTAKT_EMAIL}` as Route}
            placement="button"
            look="secondary"
            label={words.contact.email}
          />
        }
      />
    </ClassicPage>
  );
}
