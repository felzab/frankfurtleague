import { connection } from "next/server";

import { frontend_config } from "@/core/config";
import { AdminSpieleActionRequiredView } from "@/features/admin/components/views/AdminSpieleActionRequiredView";
import { getAdminSpieleActionRequired } from "@/features/admin/queries";
import { requireAdminSaison } from "@/features/saisons/resolvers";
import { getSpielberichteZustaende } from "@/features/spielberichte/queries";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { NextPageProps } from "@/shared/types/types";

export default async function AdminOverviewPage(props: NextPageProps) {
  await connection();
  const saison = await requireAdminSaison(props.searchParams);
  // The reports beside the list rather than inside it: `action_required` unions their fixtures, and their states are
  // this read's. Nothing is read while the reports are closed.
  const [adminRes, berichteRes] = await Promise.all([
    getAdminSpieleActionRequired({ saison_id: saison.id }),
    frontend_config.SPIELBERICHT_EINGABE === "on" ? getSpielberichteZustaende(saison.id) : null,
  ]);

  return (
    // No lookup lists: the cards link into the editor's own route, which loads them itself.
    <AdminSpieleActionRequiredView
      overviewSpiele={adminRes.spiele}
      bracketFaults={adminRes.bracket_faults}
      spielberichte={berichteRes?.spielberichte ?? []}
      today={getGermanTodayStr()}
      isFinishedSaison={saison.status === "past"}
    />
  );
}
