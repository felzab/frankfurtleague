import { Suspense } from "react";
import { connection } from "next/server";

import { getAdminSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getAdminSpiele } from "@/features/spiele/queries";
import { AdminSpieltageView } from "@/features/spieltage/components/views/AdminSpieltageView";
import { SPIELTAGE_CRUD_COPY } from "@/features/spieltage/constants";
import { getAdminSpieltage } from "@/features/spieltage/queries";
import { buildSpieltagPhaseProgress, spieltagLabels } from "@/features/spieltage/utils";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { FLSaison } from "@/features/saisons/schemas";
import type { AdminSpieltagRow } from "@/features/spieltage/types";
import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the list. No `createModal`: the season's matchdays come
// with its schedule, so this page shows and dates them rather than making them.
export default function AdminSpieltagePage(props: NextPageProps) {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={SPIELTAGE_CRUD_COPY.searchLabel}
          searchPlaceholder={SPIELTAGE_CRUD_COPY.searchPlaceholder}
          // This shell passes no `createModal`, so the bar joins nothing, keeping its own right edge and the row's full width.
          attachEnd={false}
        />
      }>
      {/* `sections`, because this list is phase-headed groups of cards at every width, so the table
          shape would reserve the wrong box on every viewport. */}
      <Suspense fallback={<AdminCrudFallback shape="sections" />}>
        <SpieltageList searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

/**
 * The season is the sidemenu selector's, and the list below shows that season's matchdays. `null`
 * only where the league has no seasons at all.
 */
async function resolveSelectedSaison(searchParams: NextPageProps["searchParams"]): Promise<FLSaison | null> {
  const requestedSaisonId = await resolveSaisonId(searchParams, "admin");
  const saisonsRes = await getAdminSaisons();

  // The requested season, else the active one, else the first. The whole season rather than its id:
  // its schedule is what each phase's matchday count is read against.
  return (
    saisonsRes.saisons.find((saison) => saison.id === requestedSaisonId) ??
    saisonsRes.saisons.find((saison) => saison.status === "active") ??
    saisonsRes.saisons[0] ??
    null
  );
}

/**
 * The labels are built HERE, over the whole season rather than in the view that filters: a knockout
 * round's label counts the matchdays its phase holds (`docs/frontend/spec.md` I27).
 */
async function SpieltageList({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const saison = await resolveSelectedSaison(searchParams);
  const saisonId = saison?.id ?? null;

  if (saisonId === null) {
    return (
      <AdminSpieltageView
        spieltage={[]}
        saisonId={null}
      />
    );
  }

  const [spieltageRes, spieleRes] = await Promise.all([getAdminSpieltage({ saison_id: saisonId }), getAdminSpiele({ saison_id: saisonId })]);

  const spieleBySpieltag = new Map<string, number>();
  for (const spiel of spieleRes.spiele) {
    spieleBySpieltag.set(spiel.spieltag_id, (spieleBySpieltag.get(spiel.spieltag_id) ?? 0) + 1);
  }

  // One pass rather than per row: the label needs how many matchdays the phase holds.
  const labels = spieltagLabels(spieltageRes.spieltage);

  const rows: AdminSpieltagRow[] = spieltageRes.spieltage.map((spieltag) => ({
    id: spieltag.id,
    label: labels.get(spieltag.id)?.label ?? "",
    beginn: spieltag.beginn,
    ende: spieltag.ende,
    anzahl_spiele: spieltag.anzahl_spiele,
    saison_phase: spieltag.saison_phase,
    saison_id: spieltag.saison_id,
    spieleAngelegt: spieleBySpieltag.get(spieltag.id) ?? 0,
    position: spieltag.position,
  }));

  return (
    <AdminSpieltageView
      spieltage={rows}
      saisonId={saisonId}
      phaseProgress={buildSpieltagPhaseProgress(saison?.schedule ?? [], spieltageRes.spieltage)}
    />
  );
}
