import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { saisonOf, SpielerOverview } from "../SpielerOverview";

import type { Metadata } from "next";

type Props = PageProps<"/area/spieler/[saison]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(saisonOf(saison), () => pageMetadata(ROUTES.spielerOverview, ROUTES.spielerOverview.path(saison)));
}

export default function SpielerOverviewPage({ params }: Props) {
  return <SpielerOverview saison={params.then(({ saison }) => saison)} />;
}
