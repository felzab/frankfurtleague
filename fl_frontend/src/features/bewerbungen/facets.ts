import { readFacetSelectionFromRoute } from "@/shared/utils/facets";

import { BEWERBUNG_STATUS_OPTIONS } from "./constants";

import type { Facet, FacetCounts } from "@/shared/utils/facets";
import type { FLBewerbungenListResponse } from "./schemas";
import type { AdminBewerbungRow } from "./types";

/** Spelled once: the read narrows on this parameter and the bar writes it, and the endpoint's own term carries the name. */
export const BEWERBUNGEN_STATUS_PARAM = "status";

/** The endpoint's own term too, read there against the `saison_id` the shell resolved rather than naming a season itself. */
export const BEWERBUNGEN_SAISONBEZUG_PARAM = "saisonbezug";

// Module scope is load-bearing (`docs/frontend/spec.md` §1.1).
export const BEWERBUNGEN_FACETS: readonly Facet<AdminBewerbungRow>[] = [
  {
    // Its own parameter, never `/admin/teams`'s `zugehoerigkeit`: the two lists label this question
    // alike and answer it in different words, so a value pasted between them would drop out and take
    // this facet's default with it.
    param: BEWERBUNGEN_SAISONBEZUG_PARAM,
    label: "Saison",
    options: [
      { value: "diese_saison", label: "In dieser Saison" },
      { value: "andere_saison", label: "Nicht in dieser Saison" },
    ],
    // The read is every season's applications, so unnarrowed the queue mixes seasons. The sidemenu's
    // season is the one an admin came here about; an empty parameter still reaches the archive.
    defaultValues: ["diese_saison"],
    // The default above makes an unnarrowed read the FIRST visit's state: a status counted over
    // every season is then offered with nobody having chosen anything, and leads to an empty page.
    narrowsTheRead: true,
    // Asks about the season the sidemenu holds, through the page's own flag, rather than about a
    // season of its own — the shape `TEAM_FACETS` uses.
    read: (bewerbung) => [bewerbung.inSelectedSaison ? "diese_saison" : "andere_saison"],
  },
  {
    param: BEWERBUNGEN_STATUS_PARAM,
    label: "Status",
    options: BEWERBUNG_STATUS_OPTIONS.map(({ value, label }) => ({ value: value, label: label })),
    // The list opens on the queue rather than on the archive: a decided application is a record, and
    // the decided ones stay one click away because an empty parameter turns the facet off.
    defaultValues: ["eingereicht"],
    // Narrowed on the server, so a decision leaves the working set rather than spending the read's
    // cap on rows nobody is triaging.
    narrowsTheRead: true,
    read: (bewerbung) => [bewerbung.status],
  },
  {
    param: "herkunft",
    label: "Herkunft",
    options: [
      { value: "neue_schule", label: "Neue Schule" },
      { value: "bestehendes_team", label: "Bestehendes Team" },
    ],
    // Exactly one of the two carries a value on a well-formed application, and a row carrying neither
    // matches no option rather than being filed under the wrong one — that row is what
    // `REQ-BEWERBUNG-002` refuses to accept.
    read: (bewerbung) => {
      if (bewerbung.schule !== null) return ["neue_schule"];
      return bewerbung.team_id !== null ? ["bestehendes_team"] : [];
    },
  },
];

/**
 * What `GET /bewerbungen` is asked to narrow to, comma-joined for the wire and `undefined` for everything.
 * The bar's own reader answers it, so the served rows and the pills cannot disagree about one query string.
 */
export function bewerbungenQueueTerms(
  params: Readonly<Record<string, string | string[] | undefined>>,
  saisonId: string | undefined,
): { saison_id?: string; saisonbezug?: string; status?: string } {
  const selection = readFacetSelectionFromRoute(BEWERBUNGEN_FACETS, params);

  return {
    // The season the relation beside it is asked against, and never a narrowing of its own: the
    // endpoint reads one only where the other names a season, so an unresolved one mixes seasons
    // rather than emptying the queue.
    saison_id: saisonId,
    saisonbezug: selection[BEWERBUNGEN_SAISONBEZUG_PARAM]?.join(","),
    status: selection[BEWERBUNGEN_STATUS_PARAM]?.join(","),
  };
}

/**
 * The endpoint's own counts, paired with the parameter each answers for. Every facet the read narrows on is
 * present, or `FilterPanel` counts the missing one off the rows served — which the cap already cut.
 */
export function bewerbungenQueueFacetCounts(
  counts: Pick<FLBewerbungenListResponse, "anzahl_je_status" | "anzahl_je_saisonbezug">,
): FacetCounts {
  return {
    [BEWERBUNGEN_STATUS_PARAM]: counts.anzahl_je_status,
    [BEWERBUNGEN_SAISONBEZUG_PARAM]: counts.anzahl_je_saisonbezug,
  };
}
