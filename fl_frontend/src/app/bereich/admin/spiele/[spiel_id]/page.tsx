import { Suspense } from "react";
import { notFound } from "next/navigation";

import { frontend_config } from "@/core/config";
import { AdminContextWrapper } from "@/features/admin/components/providers/AdminContextWrapper";
import { AdminSpielEditView } from "@/features/admin/components/views/AdminSpielEditView";
import { getAdminSpielbericht } from "@/features/spielberichte/queries";
import { getSpielbestaetigungen } from "@/features/spielbestaetigungen/queries";
import { getAdminSpiel } from "@/features/spiele/queries";
import { resolveSpielId } from "@/features/spiele/resolvers";
import { spielStateKey } from "@/features/spiele/utils";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";
import { nullAfterLoggingUnexplained } from "@/shared/utils/degradedRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { SpielberichtStand } from "@/features/spielberichte/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The match editor. One fixture per URL. **The page resolves NOTHING itself** — every await sits
 * inside the boundary below, which keeps a fallback-params route renderable. The sibling editors
 * follow the same shape.
 */
export default function AdminSpielEditPage(props: NextPageProps<{ spiel_id: string }>) {
  return (
    // A top-level await ties the FALLBACK-params App Shell to one URL, and Next then raises
    // `postponed state ... fallback params` on any `updateTag`.
    // https://nextjs.org/docs/app/guides/incremental-static-regeneration-cache-components
    <Suspense fallback={<ContentLoader />}>
      <AdminSpielEditContent params={props.params} />
    </Suspense>
  );
}

async function AdminSpielEditContent({ params }: { params: NextPageProps<{ spiel_id: string }>["params"] }) {
  const spielId = await resolveSpielId(params);

  const [spielRes, berichtRes] = await Promise.all([
    // Admin-tier and uncached, so the editor seeds from the fixture as it stands rather than from a
    // cache entry hours old. `null` is "no such fixture"; everything else throws.
    getAdminSpiel(spielId),
    // Uncached for the same reason: „Vorschlag übernehmen“ seeds from the report version standing now. A failed read
    // is `null`, which the panel says, as the confirmations' panel says its own.
    runWithIncomingTrace(() => getAdminSpielbericht(spielId).catch(nullAfterLoggingUnexplained)),
  ]);
  const eingabeOffen = frontend_config.SPIELBERICHT_EINGABE === "on";
  // Read whatever the switch: the triage files a standing report's fixture whatever it reads, and only the adoption
  // here clears it. Closed, a fixture with no report shows no panel, and a standing one offers no correction.
  const spielbericht: SpielberichtStand | null | undefined =
    berichtRes === null ? null : eingabeOffen || berichtRes.bericht !== null ? { lesen: berichtRes, korrigierbar: eingabeOffen } : undefined;

  if (!spielRes) {
    notFound();
  }

  // Behind the trace's wait for a request, as the fixture's read is, so a prefetch carries neither. Degraded rather than awaited whole: the
  // editor is how a fixture is repaired, and stands when its confirmations cannot be read.
  const bestaetigungenRes = await runWithIncomingTrace(() =>
    getSpielbestaetigungen({ saison_id: spielRes.spiel.saison_id, spiel_id: spielRes.spiel.id }).catch(nullAfterLoggingUnexplained),
  );

  return (
    // The fixture's OWN season, not the current one: the pickers must offer the teams and feeder
    // matches of the season being edited, which may be a past one.
    <AdminContextWrapper saison_id={spielRes.spiel.saison_id}>
      {/* The same route pattern reconciles in place, so without a key the draft atoms carry the
          previous fixture's values in. Keyed on STORED STATE, not the id, so a write that moved
          the fixture underneath resets the subtree. */}
      <AdminSpielEditView
        key={spielStateKey(spielRes.spiel)}
        spielData={spielRes.spiel}
        today={getGermanTodayStr()}
        // The comparison the timer is armed on, so the near-date warning never announces a request no pass sends.
        isSpielSweepOn={frontend_config.SPIEL_SWEEP === "on"}
        bestaetigungen={
          bestaetigungenRes === null
            ? null
            : { zeilen: bestaetigungenRes.spielbestaetigungen, gelaufenAm: bestaetigungenRes.spiel_sweep_gelaufen_am }
        }
        spielbericht={spielbericht}
      />
    </AdminContextWrapper>
  );
}
