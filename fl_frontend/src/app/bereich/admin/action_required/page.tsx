import { connection } from "next/server";

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
  // The reports beside the list rather than inside it: `action_required` unions their fixtures whatever the switch
  // reads, and their states are this read's, so it is read whatever the switch reads too, or those fixtures sit under
  // no category.
  const [adminRes, bestaetigungenRes, berichteRes] = await Promise.all([
    getAdminSpieleActionRequired({ saison_id: saison.id }),
    // The queue's own season, so the two lists disagree about no fixture; degraded rather than awaited whole, the
    // fixtures' categories standing without it.
    runWithIncomingTrace(() => getSpielbestaetigungen({ saison_id: saison.id }).catch(nullUnlessContractBreak)),
    getSpielberichteZustaende({ saison_id: saison.id }),
  ]);

  return (
    // No lookup lists: the cards link into the editor's own route, which loads them itself.
    <AdminSpieleActionRequiredView
      overviewSpiele={adminRes.spiele}
      bracketFaults={adminRes.bracket_faults}
      bestaetigungen={bestaetigungenRes?.spielbestaetigungen ?? null}
      bestaetigungenVollstaendig={bestaetigungenRes?.vollstaendig ?? true}
      spielberichte={berichteRes.spielberichte}
      today={getGermanTodayStr()}
      isFinishedSaison={saison.status === "past"}
    />
  );
}
