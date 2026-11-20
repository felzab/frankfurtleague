import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { SchiedsrichterOverview, spieleOf } from "../SchiedsrichterOverview";

import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/area/schiedsrichter/[saison]">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(spieleOf(saison), () => pageMetadata(parent, ROUTES.schiedsrichterOverview, ROUTES.schiedsrichterOverview.path(saison)));
}

export default function SchiedsrichterOverviewPage({ params }: Props) {
  return <SchiedsrichterOverview saison={params.then(({ saison }) => saison)} />;
}
