"use client";

import { KONTAKTE_FACETS } from "@/features/teams/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import { AdminKontakteTable } from "../collections/AdminKontakteTable";

import type { AdminKontaktRow } from "@/features/teams/types";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. The seat is
// not among them because it is a facet: searching would match the stored slug and not the label.
const SEARCH_KEYS = ["vorname", "nachname", "email", "telefon", "teamName", "teamShorthand"] as const;

/**
 * **Neither modal renderer is passed, and that is the shape of this resource**: the contacts are
 * written on each team's own page, so a row here has nothing to open and nothing to delete.
 */
export function AdminKontakteView({ kontakte }: { kontakte: AdminKontaktRow[] }) {
  return (
    <AdminCrudView<AdminKontaktRow>
      items={kontakte}
      searchKeys={SEARCH_KEYS}
      facets={KONTAKTE_FACETS}
      renderTable={({ filteredItems, emptiness }) => (
        <AdminKontakteTable
          filteredKontakte={filteredItems}
          emptiness={emptiness}
        />
      )}
    />
  );
}
