import { connection } from "next/server";

import { AdminSpieleActionRequiredView } from "@/features/admin/components/views/AdminSpieleActionRequiredView";
import { getAdminSpieleActionRequired } from "@/features/admin/queries";
import { requireAdminSaison } from "@/features/saisons/resolvers";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { NextPageProps } from "@/shared/types/types";

export default async function AdminOverviewPage(props: NextPageProps) {
  await connection();
  const saison = await requireAdminSaison(props.searchParams);
  const adminRes = await getAdminSpieleActionRequired({ saison_id: saison.id });

  return (
    // No lookup lists: the cards link into the editor's own route, which loads them itself.
    <AdminSpieleActionRequiredView
      overviewSpiele={adminRes.spiele}
      bracketFaults={adminRes.bracket_faults}
      today={getGermanTodayStr()}
      isFinishedSaison={saison.status === "past"}
    />
  );
}
