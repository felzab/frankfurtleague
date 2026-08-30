import { connection } from "next/server";

import { AdminSpieleActionRequiredView } from "@/features/admin/components/views/AdminSpieleActionRequiredView";
import { getAdminSpieleActionRequired } from "@/features/admin/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { NextPageProps } from "@/shared/types/types";

export default async function AdminOverviewPage(props: NextPageProps) {
  await connection();
  const specifiedSaisonId = await resolveSaisonId(props.searchParams, "admin");
  const adminRes = await getAdminSpieleActionRequired({ saison_id: specifiedSaisonId });

  return (
    // No lookup lists: the cards link into the editor's own route, which loads them itself.
    <AdminSpieleActionRequiredView
      overviewSpiele={adminRes.spiele}
      bracketFaults={adminRes.bracket_faults}
      today={getGermanTodayStr()}
    />
  );
}
