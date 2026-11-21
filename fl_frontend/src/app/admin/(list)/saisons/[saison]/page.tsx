import { ROUTES } from "@/core/routes";
import { getSaisonOverview } from "@/features/saisons/queries";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { AdminOverview } from "./AdminOverview";

import type { Metadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(getSaisonOverview(saison), () => pageMetadata(ROUTES.adminOverview, ROUTES.adminOverview.path(saison)));
}

export default function OverviewPage({ params }: Props) {
  return <AdminOverview saison={params.then(({ saison }) => saison)} />;
}
