"use client";

import { useMemo } from "react";

import { AdminSpieltageList } from "@/features/spieltage/components/collections/AdminSpieltageList";
import { SPIELTAG_FACETS } from "@/features/spieltage/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { formatSpielDatum } from "@/shared/utils/format";

import type { AdminSpieltagRow } from "@/features/spieltage/types";
import type { SpieltagPhaseProgress } from "@/features/spieltage/utils";

// Module scope: a fresh array here would defeat `useFuzzySearch`'s memo on every render. `label` is
// a field of the row rather than of the document, because a search matches what is read — the rule
// that also puts the rows' German date spellings beside the stored ones here.
const SEARCH_KEYS = ["label", "beginn", "ende", "searchable_beginn", "searchable_ende"] as const;

/**
 * `renderTable` is not a table: that slot takes whatever places many of one thing, and a matchday
 * list needs phase-sectioned order rather than a grid. `renderEditModal` is not passed — the form
 * edits on a page, so the row's pencil is a `<Link>`.
 */
export function AdminSpieltageView({
  spieltage,
  saisonId,
  phaseProgress,
}: {
  spieltage: AdminSpieltagRow[];
  saisonId: string | null;
  /**
   * Passed through untouched rather than derived here: both numbers are facts about the season rather
   * than about the filtered rows (`fl_frontend/src/features/spieltage/utils.ts :: buildSpieltagPhaseProgress`).
   */
  phaseProgress?: readonly SpieltagPhaseProgress[];
}) {
  // A reader types the spelling they have seen on the rows. Deriving it through the formatter the
  // list renders with — never a string reversal — is what keeps the two spellings agreeing. An
  // undated matchday derives `null`, which matches nothing — never the rendered placeholder.
  const processedSpieltage = useMemo(
    () =>
      spieltage.map((spieltag) => ({
        ...spieltag,
        searchable_beginn: spieltag.beginn === null ? null : formatSpielDatum(spieltag.beginn),
        searchable_ende: spieltag.ende === null ? null : formatSpielDatum(spieltag.ende),
      })),
    [spieltage],
  );

  return (
    <AdminCrudView<AdminSpieltagRow>
      isCollection={false}
      items={processedSpieltage}
      searchKeys={SEARCH_KEYS}
      facets={SPIELTAG_FACETS}
      renderTable={({ filteredItems, emptiness }) => (
        <AdminSpieltageList
          filteredSpieltage={filteredItems}
          emptiness={emptiness}
          saisonId={saisonId}
          phaseProgress={phaseProgress}
        />
      )}
    />
  );
}
