import { Suspense } from "react";
import { connection } from "next/server";

import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { AdminCreateSpieltagModal } from "@/features/spieltage/components/modals/AdminCreateSpieltagModal";
import { AdminSpieltageView } from "@/features/spieltage/components/views/AdminSpieltageView";
import { SPIELTAGE_CRUD_COPY } from "@/features/spieltage/constants";
import { getSpieltage } from "@/features/spieltage/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { AdminSpieltagRow } from "@/features/spieltage/types";
import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the matchday list — the pattern of the sibling pages. The create
// modal needs the season and its existing positions (it opens on the next free one), so it gets its own
// boundary instead of making the whole page async. `connection()` sits with each fetch it guards —
// ADR-0009 requires only that nothing fetches at build time.
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
        // The fallback holds the trigger's own height (`formButton` trigger: h-12, lg:h-15), so the header
        // row does not jump when the season-loaded modal streams in.
        <Suspense fallback={<div className="h-12 lg:h-15" />}>
          <CreateSpieltagModalLoader searchParams={props.searchParams} />
        </Suspense>
      }>
      <Suspense fallback={<AdminCrudFallback />}>
        <SpieltageList searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

/**
 * Which season a matchday belongs to, and the positions its siblings already hold.
 *
 * The season is the sidemenu selector's — a matchday is created into the season the page is showing, so
 * there is no season picker in the form. `null` only where the league has no seasons at all.
 */
async function resolveSelectedSaison(searchParams: NextPageProps["searchParams"]): Promise<string | null> {
  const requestedSaisonId = await resolveSaisonId(searchParams);
  const saisonsRes = await getSaisons();

  // The requested season when it exists, else the active one, else the first — the same fallback chain the
  // club and player lists use, so the four admin surfaces agree about which season they are showing.
  return (
    saisonsRes.saisons.find((saison) => saison.id === requestedSaisonId)?.id ??
    saisonsRes.saisons.find((saison) => saison.status === "active")?.id ??
    saisonsRes.saisons[0]?.id ??
    null
  );
}

async function CreateSpieltagModalLoader({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const saisonId = await resolveSelectedSaison(searchParams);

  // Retired matchdays included when working out the next position: a retired one still holds its
  // `order_val`, so reusing it would seed a collision the moment somebody reactivated it.
  const spieltage = saisonId === null ? [] : (await getSpieltage({ saison_id: saisonId, include_inactive: true })).spieltage;
  const orderVals = spieltage.map((spieltag) => spieltag.order_val);

  return (
    <AdminCreateSpieltagModal
      saisonId={saisonId}
      nextOrderVal={orderVals.length === 0 ? 0 : Math.max(...orderVals) + 1}
      orderValInUse={orderVals}
    />
  );
}

/**
 * Every matchday of the selected season, retired ones included, each carrying the two facts the list
 * exists to show.
 *
 * **Two reads, and the second is what makes this more than a list of stored fields.** `GET /spiele` for the
 * season gives the fixtures actually attached to each matchday, which is the only way `anzahl_spiele` — a
 * hand-maintained count the backend writes as given and never derives — can be checked against reality.
 * Retired matchdays are included for the same reason the delete is soft: their matches are untouched and
 * still resolve, so hiding the matchday would hide why those fixtures are where they are.
 */
async function SpieltageList({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const saisonId = await resolveSelectedSaison(searchParams);

  if (saisonId === null) {
    return (
      <AdminSpieltageView
        spieltage={[]}
        saisonId={null}
      />
    );
  }

  const [spieltageRes, spieleRes] = await Promise.all([
    getSpieltage({ saison_id: saisonId, include_inactive: true }),
    getSpiele({ saison_id: saisonId }),
  ]);

  // How many fixtures each matchday actually holds. Counted from the season's matches rather than asked
  // for per matchday: one read answers it for all of them.
  const spieleBySpieltag = new Map<string, number>();
  for (const spiel of spieleRes.spiele) {
    spieleBySpieltag.set(spiel.spieltag_id, (spieleBySpieltag.get(spiel.spieltag_id) ?? 0) + 1);
  }

  // How many matchdays hold each position. A position held twice is a collision on BOTH rows, which is why
  // this is a count rather than a set of seen values.
  const holdersByOrderVal = new Map<number, number>();
  for (const spieltag of spieltageRes.spieltage) {
    holdersByOrderVal.set(spieltag.order_val, (holdersByOrderVal.get(spieltag.order_val) ?? 0) + 1);
  }

  const rows: AdminSpieltagRow[] = spieltageRes.spieltage.map((spieltag) => ({
    id: spieltag.id,
    name: spieltag.name,
    beginn: spieltag.beginn,
    ende: spieltag.ende,
    anzahl_spiele: spieltag.anzahl_spiele,
    order_val: spieltag.order_val,
    saison_phase: spieltag.saison_phase,
    saison_id: spieltag.saison_id,
    inactive_since: spieltag.inactive_since,
    spieleAngelegt: spieleBySpieltag.get(spieltag.id) ?? 0,
    hasOrderCollision: (holdersByOrderVal.get(spieltag.order_val) ?? 0) > 1,
  }));

  return (
    <AdminSpieltageView
      spieltage={rows}
      saisonId={saisonId}
    />
  );
}
