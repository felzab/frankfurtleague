"use client";

import { useMemo } from "react";

import { buildKontakteFacets } from "@/features/teams/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import { AdminKontakteTable } from "../collections/AdminKontakteTable";

import type { AdminKontakteRow } from "@/features/teams/types";

/* Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. The seat keys
   walk the row's `seats` array, which Fuse does natively; a seat's label is a column heading rather
   than a value to search. */
const SEARCH_KEYS = [
  "teamName",
  "teamShorthand",
  "seats.person.vorname",
  "seats.person.nachname",
  "seats.person.email",
  "seats.person.telefon",
] as const;

/**
 * **No `renderDeleteModal`, and no editing**: each team's own page owns its contacts, so a row here
 * is only ever read.
 */
export function AdminKontakteView({ kontakte, teams }: { kontakte: AdminKontakteRow[]; teams: readonly { teamId: string; name: string }[] }) {
  /* Built HERE and never handed down: a facet carries a `read` FUNCTION, which a Server Component
     may not pass to a Client one (`.claude/rules/frontend.md`). Neither `tsc` nor the build sees it and
     the page throws at render. */
  const facets = useMemo(() => buildKontakteFacets(teams), [teams]);

  return (
    <AdminCrudView<AdminKontakteRow>
      items={kontakte}
      searchKeys={SEARCH_KEYS}
      facets={facets}
      renderTable={({ filteredItems, emptiness }) => (
        <AdminKontakteTable
          filteredKontakte={filteredItems}
          emptiness={emptiness}
        />
      )}
    />
  );
}
