import { connection } from "next/server";

import { frontend_config } from "@/core/config";
import { AdminSpieleActionRequiredView } from "@/features/admin/components/views/AdminSpieleActionRequiredView";
import { getAdminSpieleActionRequired } from "@/features/admin/queries";
import { requireAdminSaison } from "@/features/saisons/resolvers";
import { getSpielberichteZustaende } from "@/features/spielberichte/queries";
import { getSpielbestaetigungen } from "@/features/spielbestaetigungen/queries";
import { getGermanTodayStr } from "@/shared/utils/date";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { NextPageProps } from "@/shared/types/types";

export default async function AdminOverviewPage(props: NextPageProps) {
  await connection();
  const saison = await requireAdminSaison(props.searchParams);
  // The reports beside the list rather than inside it: `action_required` unions their fixtures, and their states are
  // this read's. Nothing is read while the reports are closed.
  const [adminRes, bestaetigungenRes, berichteRes] = await Promise.all([
    getAdminSpieleActionRequired({ saison_id: saison.id }),
    // The queue's own season, so the two lists disagree about no fixture; degraded rather than awaited whole, the
    // fixtures' categories standing without it.
    runWithIncomingTrace(() => getSpielbestaetigungen({ saison_id: saison.id }).catch(nullUnlessContractBreak)),
    frontend_config.SPIELBERICHT_EINGABE === "on" ? getSpielberichteZustaende({ saison_id: saison.id }) : null,
  ]);

  return (
    // No lookup lists: the cards link into the editor's own route, which loads them itself.
    <AdminSpieleActionRequiredView
      overviewSpiele={adminRes.spiele}
      bracketFaults={adminRes.bracket_faults}
      bestaetigungen={bestaetigungenRes?.spielbestaetigungen ?? null}
      bestaetigungenVollstaendig={bestaetigungenRes?.vollstaendig ?? true}
      spielberichte={berichteRes?.spielberichte ?? []}
      today={getGermanTodayStr()}
      isFinishedSaison={saison.status === "past"}
    />
  );
}
