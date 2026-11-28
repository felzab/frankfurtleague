import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { SchiedsrichterOverview, spieleOf } from "../SchiedsrichterOverview";

import type { Metadata } from "next";

type Props = PageProps<"/area/schiedsrichter/[saison]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(spieleOf(saison), () => pageMetadata(ROUTES.schiedsrichterOverview, ROUTES.schiedsrichterOverview.path(saison)));
}

export default function SchiedsrichterOverviewPage({ params }: Props) {
  return <SchiedsrichterOverview saison={params.then(({ saison }) => saison)} />;
}
