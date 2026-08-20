import { Suspense } from "react";
import { connection } from "next/server";

import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { AdminCreateSpieltagModal } from "@/features/spieltage/components/modals/AdminCreateSpieltagModal";
import { AdminSpieltageView } from "@/features/spieltage/components/views/AdminSpieltageView";
import { SPIELTAGE_CRUD_COPY } from "@/features/spieltage/constants";
import { getSpieltage } from "@/features/spieltage/queries";
import { buildSpieltagPhaseProgress, spieltagLabels } from "@/features/spieltage/utils";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { FLSaison } from "@/features/saisons/schemas";
import type { AdminSpieltagRow } from "@/features/spieltage/types";
import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the list. The create modal needs to know which season
// it creates into, so it gets its own boundary.
export default function AdminSpieltagePage(props: NextPageProps) {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={SPIELTAGE_CRUD_COPY.searchLabel}
          searchPlaceholder={SPIELTAGE_CRUD_COPY.searchPlaceholder}
        />
      }
      createModal={
        // The fallback holds the trigger's own height, so the header row does not jump.
        <Suspense fallback={<div className="h-12 lg:h-15" />}>
          <CreateSpieltagModalLoader searchParams={props.searchParams} />
        </Suspense>
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
 * The season is the sidemenu selector's — a matchday is created into the season on screen, so the
 * form has no season picker. `null` only where the league has no seasons at all.
 */
async function resolveSelectedSaison(searchParams: NextPageProps["searchParams"]): Promise<FLSaison | null> {
  const requestedSaisonId = await resolveSaisonId(searchParams);
  const saisonsRes = await getSaisons();

  // The requested season, else the active one, else the first. The whole season rather than its id:
  // its span bounds both matchday date pickers (`REQ-DATE-002`).
  return (
    saisonsRes.saisons.find((saison) => saison.id === requestedSaisonId) ??
    saisonsRes.saisons.find((saison) => saison.status === "active") ??
    saisonsRes.saisons[0] ??
    null
  );
}

/**
 * `REQ-SPIELTAG-003` refuses a create once the knockout phase is under way — the earliest non-group
 * matchday beginning today or earlier — so the trigger refuses before opening a dialog onto a 409.
 * The endpoint stays the authority.
 */
async function CreateSpieltagModalLoader({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const saison = await resolveSelectedSaison(searchParams);
  const saisonId = saison?.id ?? null;

  const spieltageRes = saisonId === null ? null : await getSpieltage({ saison_id: saisonId });
  const knockoutBeginn = (spieltageRes?.spieltage ?? [])
    .filter((spieltag) => spieltag.saison_phase !== "gruppenphase")
    .map((spieltag) => spieltag.beginn)
    .sort()
    .at(0);

  return (
    <AdminCreateSpieltagModal
      saisonId={saisonId}
      saisonSpan={saison === null ? undefined : { start: saison.start_date, end: saison.end_date }}
      saisonSchedule={saison?.schedule}
      knockoutBeginn={knockoutBeginn ?? null}
      today={getGermanTodayStr()}
    />
  );
}

/**
 * Every matchday of the season, in the API's order, which this page does not reorder. The labels are
 * built HERE, over the whole season: what a knockout round's label needs is how many matchdays its
 * phase holds, which is a fact about the season and not about the rows a filter left on screen.
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

  const [spieltageRes, spieleRes] = await Promise.all([getSpieltage({ saison_id: saisonId }), getSpiele({ saison_id: saisonId })]);

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
