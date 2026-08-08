import { Suspense } from "react";
import { connection } from "next/server";

import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { AdminCreateSpieltagModal } from "@/features/spieltage/components/modals/AdminCreateSpieltagModal";
import { AdminSpieltageView } from "@/features/spieltage/components/views/AdminSpieltageView";
import { SPIELTAGE_CRUD_COPY } from "@/features/spieltage/constants";
import { getSpieltage } from "@/features/spieltage/queries";
import { spieltagLabels } from "@/features/spieltage/utils";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";
import { getGermanTodayStr } from "@/shared/utils/date";

import type { FLSaison } from "@/features/saisons/schemas";
import type { AdminSpieltagRow } from "@/features/spieltage/types";
import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the matchday list — the pattern of the sibling pages. The create
// modal needs to know which season it creates into, so it gets its own boundary instead of making the whole
// page async. `connection()` sits with each fetch it guards — ADR-0009 requires only that nothing fetches
// at build time.
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
async function resolveSelectedSaison(searchParams: NextPageProps["searchParams"]): Promise<FLSaison | null> {
  const requestedSaisonId = await resolveSaisonId(searchParams);
  const saisonsRes = await getSaisons();

  // The requested season when it exists, else the active one, else the first — the same fallback chain the
  // club and player lists use, so the four admin surfaces agree about which season they are showing.
  //
  // The whole season rather than its id: its `start_date`/`end_date` bound both matchday date pickers
  // (`REQ-DATE-002`), and this read already had them.
  return (
    saisonsRes.saisons.find((saison) => saison.id === requestedSaisonId) ??
    saisonsRes.saisons.find((saison) => saison.status === "active") ??
    saisonsRes.saisons[0] ??
    null
  );
}

/**
 * The season, plus the one fact that can close the create window.
 *
 * The order is derived, so there is no next-free-position to work out (ADR-0064) — but `REQ-SPIELTAG-003`
 * refuses a create once the season's knockout phase is under way, and "under way" is the earliest
 * non-group matchday beginning today or earlier. That is a read this page is already making, so the
 * trigger can refuse BEFORE the request rather than opening a dialog onto a 409 (owner, 2026-08-08).
 *
 * The endpoint stays the authority: a page left open past midnight, or a knockout matchday re-dated in
 * another tab, both reach it.
 */
async function CreateSpieltagModalLoader({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const saison = await resolveSelectedSaison(searchParams);
  const saisonId = saison?.id ?? null;

  // Retired matchdays INCLUDED, matching the endpoint: a retired knockout matchday is still a date the
  // bracket was scheduled to start on, and hiding it from a list does not un-start the phase.
  const spieltageRes = saisonId === null ? null : await getSpieltage({ saison_id: saisonId, include_inactive: true });
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
 * Every matchday of the selected season, retired ones included, in the order they are played.
 *
 * **Two reads, and the second is what makes this more than a list of stored fields.** `GET /spiele` for the
 * season gives the fixtures actually attached to each matchday, which is the only way the expected count —
 * derived from the season's rules and the matchday's phase (ADR-0065) — can be checked against reality.
 * Retired matchdays are included for the same reason the delete is soft: their matches are untouched and
 * still resolve, so hiding the matchday would hide why those fixtures are where they are.
 *
 * **The order is the API's and this page does not reorder it** (ADR-0064). What it adds is the `ordinal`:
 * a 1-based counter per phase, assigned by walking the received order once. Assigning it here rather than
 * in the list is what keeps it out of the client bundle and out of the filtered view — a filter that hides
 * the second matchday must not renumber the third.
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

  const [spieltageRes, spieleRes] = await Promise.all([
    getSpieltage({ saison_id: saisonId, include_inactive: true }),
    getSpiele({ saison_id: saisonId }),
  ]);

  // How many fixtures each matchday actually holds. Counted from the season's matches rather than asked
  // for per matchday: one read answers it for all of them.
  // Two counts per matchday from the one read: everything attached, and how much of it is played. The
  // second is what `REQ-RETIRE-002` refuses a retirement over, so the list needs it to avoid offering a
  // control whose answer it already knows.
  const spieleBySpieltag = new Map<string, number>();
  const gespieltBySpieltag = new Map<string, number>();
  for (const spiel of spieleRes.spiele) {
    spieleBySpieltag.set(spiel.spieltag_id, (spieleBySpieltag.get(spiel.spieltag_id) ?? 0) + 1);
    if (spiel.ergebnis !== null) {
      gespieltBySpieltag.set(spiel.spieltag_id, (gespieltBySpieltag.get(spiel.spieltag_id) ?? 0) + 1);
    }
  }

  // The ordinal and the label together, counted per phase over the order the API returned (ADR-0067). One
  // pass rather than per row, because the label needs to know how many matchdays the phase holds.
  const labels = spieltagLabels(spieltageRes.spieltage);

  const rows: AdminSpieltagRow[] = spieltageRes.spieltage.map((spieltag) => {
    const derived = labels.get(spieltag.id);

    return {
      id: spieltag.id,
      label: derived?.label ?? "",
      beginn: spieltag.beginn,
      ende: spieltag.ende,
      anzahl_spiele: spieltag.anzahl_spiele,
      saison_phase: spieltag.saison_phase,
      saison_id: spieltag.saison_id,
      inactive_since: spieltag.inactive_since,
      spieleAngelegt: spieleBySpieltag.get(spieltag.id) ?? 0,
      spieleGespielt: gespieltBySpieltag.get(spieltag.id) ?? 0,
      ordinal: derived?.ordinal ?? 1,
    };
  });

  return (
    <AdminSpieltageView
      spieltage={rows}
      saisonId={saisonId}
      saisonSpan={saison === null ? undefined : { start: saison.start_date, end: saison.end_date }}
      saisonSchedule={saison?.schedule}
    />
  );
}
