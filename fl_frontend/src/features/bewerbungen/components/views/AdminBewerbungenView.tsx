"use client";

import { useMemo } from "react";

import { findBewerbungDubletten } from "@/features/bewerbungen/duplicates";
import { BEWERBUNGEN_FACETS } from "@/features/bewerbungen/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import { AdminBewerbungenTable } from "../collections/AdminBewerbungenTable";
import { BewerbungenUnvollstaendigNotice } from "../ui/BewerbungenUnvollstaendigNotice";

import type { AdminBewerbungRow } from "@/features/bewerbungen/types";
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
  unvollstaendig = null,
}: {
  bewerbungen: AdminBewerbungRow[];
  /** Present only where the endpoint answered with part of the queue, and then carrying the ways out of it. */
  unvollstaendig?: BewerbungenUnvollstaendig | null;
}) {
  // Derived from the WHOLE list and never from the filtered one: a search or a facet hiding one half
  // of a pair would take the mark off the half still on screen. Memoized so the table's own `memo`
  // still holds — a fresh Map every render defeats it.
  const dubletten = useMemo(() => findBewerbungDubletten(bewerbungen), [bewerbungen]);

  return (
    <div className="flex flex-col gap-4">
      {unvollstaendig !== null && <BewerbungenUnvollstaendigNotice {...unvollstaendig} />}

      <AdminCrudView<AdminBewerbungRow>
        items={bewerbungen}
        searchKeys={SEARCH_KEYS}
        facets={BEWERBUNGEN_FACETS}
        renderTable={({ filteredItems, emptiness }) => (
          <AdminBewerbungenTable
            filteredBewerbungen={filteredItems}
            dubletten={dubletten}
            emptiness={emptiness}
          />
        )}
      />
    </div>
  );
}
