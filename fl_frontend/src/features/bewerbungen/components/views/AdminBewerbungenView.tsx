"use client";

import { useMemo } from "react";

import { markBewerbungDubletten } from "@/features/bewerbungen/duplicates";
import { BEWERBUNGEN_FACETS, bewerbungenQueueFacetCounts } from "@/features/bewerbungen/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import { AdminBewerbungenList } from "../collections/AdminBewerbungenList";
import { BewerbungenUnvollstaendigNotice } from "../ui/BewerbungenUnvollstaendigNotice";

import type { FLBewerbungenListResponse } from "@/core/generated/client/types";
import type { AdminBewerbungRow } from "@/features/bewerbungen/types";
import type { Leserichtung } from "@/shared/utils/leserichtung";
import type { BewerbungenUnvollstaendig } from "../ui/BewerbungenUnvollstaendigNotice";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render.
const SEARCH_KEYS = [
  "teamName",
  "saison_id",
  "schule.full_name",
  "schule.address.stadt",
  "kontakte.trainer.nachname",
  "kontakte.trainer.email",
  "kontakte.ansprechperson.nachname",
  "kontakte.ansprechperson.email",
  "kontakte.stellvertretung.nachname",
  "kontakte.stellvertretung.email",
] as const;

/** No create control and no delete: this surface decides applications, and no endpoint writes or removes one. */
export function AdminBewerbungenView({
  bewerbungen,
  anzahlJeStatus,
  anzahlJeSaisonbezug,
  dublettenSchluessel,
  richtung,
  unvollstaendig = null,
}: {
  bewerbungen: AdminBewerbungRow[];
  /** The endpoint's own counts, one map per facet the read narrows on: `bewerbungen` holds only what those selected. */
  anzahlJeStatus: FLBewerbungenListResponse["count_per_status"];
  anzahlJeSaisonbezug: FLBewerbungenListResponse["count_per_saison_reference"];
  /** Which keys collide over the WHOLE queue, which is the only place a pair the read's cap parted is visible. */
  dublettenSchluessel: FLBewerbungenListResponse["duplicates_key"];
  /** Required whether or not the read was cut short: the bar offers the other end of a complete queue too. */
  richtung: Leserichtung;
  /** Present only where the endpoint answered with part of the queue, and then carrying the ways out of it. */
  unvollstaendig?: BewerbungenUnvollstaendig | null;
}) {
  // Memoized so the table's own `memo` still holds — a fresh Map every render defeats it.
  const dubletten = useMemo(() => markBewerbungDubletten(bewerbungen, dublettenSchluessel), [bewerbungen, dublettenSchluessel]);

  return (
    <div className="flex flex-col gap-4">
      {unvollstaendig !== null && <BewerbungenUnvollstaendigNotice {...unvollstaendig} />}

      <AdminCrudView<AdminBewerbungRow>
        items={bewerbungen}
        searchKeys={SEARCH_KEYS}
        facets={BEWERBUNGEN_FACETS}
        facetCounts={bewerbungenQueueFacetCounts({ count_per_status: anzahlJeStatus, count_per_saison_reference: anzahlJeSaisonbezug })}
        leserichtung={richtung}
        shape="cards"
        renderTable={({ filteredItems, emptiness }) => (
          <AdminBewerbungenList
            filteredBewerbungen={filteredItems}
            dubletten={dubletten}
            emptiness={emptiness}
          />
        )}
      />
    </div>
  );
}
