"use client";

import { useMemo } from "react";

import { AdminSpielerTable } from "@/features/spieler/components/collections/AdminSpielerTable";
import { AdminDeleteSpielerModal } from "@/features/spieler/components/modals/AdminDeleteSpielerModal";
import { buildSpielerFacets } from "@/features/spieler/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { AdminSpielerRow, SpielerTeamOption } from "@/features/spieler/types";

// Module scope: a fresh array would defeat `useFuzzySearch`'s memo on every render.
const SEARCH_KEYS = ["fullName", "selected.teamName", "selected.nummer"] as const;

/** Player-centric rows spanning every season, with the selected season's squad row beside them. */
export function AdminSpielerView({
  spieler,
  teams,
  selectedSaisonId,
  selectedSaisonStatus,
}: {
  spieler: AdminSpielerRow[];
  /** The selected season's clubs, for the team facet's options. */
  teams: SpielerTeamOption[];
  selectedSaisonId: string;
  selectedSaisonStatus: "past" | "active" | "future";
}) {
  // Memoised for identity: `AdminCrudView` requires a stable collection.
  const facets = useMemo(() => buildSpielerFacets(teams), [teams]);

  return (
    <AdminCrudView<AdminSpielerRow>
      items={spieler}
      searchKeys={SEARCH_KEYS}
      facets={facets}
      renderTable={({ query, filteredItems, onDelete }) => (
        <AdminSpielerTable
          spielerQuery={query}
          filteredSpieler={filteredItems}
          selectedSaisonId={selectedSaisonId}
          selectedSaisonStatus={selectedSaisonStatus}
          setDeletingSpieler={onDelete}
        />
      )}
      renderDeleteModal={({ item, isOpen, onClose }) => (
        <AdminDeleteSpielerModal
          spielerData={item}
          isOpen={isOpen}
          onClose={onClose}
        />
      )}
    />
  );
}
