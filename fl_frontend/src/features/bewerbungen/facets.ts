import { BEWERBUNG_STATUS_OPTIONS } from "./constants";

import type { Facet } from "@/shared/utils/facets";
import type { AdminBewerbungRow } from "./types";

// Module scope is load-bearing: `AdminCrudView`'s memo and the react-aria collection behind it both
// key on the array's identity.
export const BEWERBUNGEN_FACETS: readonly Facet<AdminBewerbungRow>[] = [
  {
    // Its own parameter, never `/admin/teams`'s `zugehoerigkeit`: the two lists label this question
    // alike and answer it in different words, so a value pasted between them would drop out and take
    // this facet's default with it.
    param: "saisonbezug",
    label: "Saison",
    options: [
      { value: "diese_saison", label: "In dieser Saison" },
      { value: "andere_saison", label: "Nicht in dieser Saison" },
    ],
    // The read is every season's applications, so unnarrowed the queue mixes seasons. The sidemenu's
    // season is the one an admin came here about; an empty parameter still reaches the archive.
    defaultValues: ["diese_saison"],
    // Asks about the season the sidemenu holds, through the page's own flag, rather than about a
    // season of its own — the shape `TEAM_FACETS` uses.
    read: (bewerbung) => [bewerbung.inSelectedSaison ? "diese_saison" : "andere_saison"],
  },
  {
    param: "status",
    label: "Status",
    options: BEWERBUNG_STATUS_OPTIONS.map(({ value, label }) => ({ value: value, label: label })),
    // The list opens on the queue rather than on the archive: a decided application is a record, and
    // the decided ones stay one click away because an empty parameter turns the facet off.
    defaultValues: ["eingereicht"],
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
