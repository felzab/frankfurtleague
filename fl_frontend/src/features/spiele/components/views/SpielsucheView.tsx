"use client";

import { useMemo } from "react";

import { FilterBar } from "@/shared/components/ui/FilterBar";
import { CARDS_CASCADE } from "@/shared/components/ui/motion";
import { SearchBar } from "@/shared/components/ui/SearchBar";
import { useDebouncedUrlQuery } from "@/shared/hooks/useDebouncedUrlQuery";
import { useFuzzySearch } from "@/shared/hooks/useFuzzySearch";
import { useUrlFilters } from "@/shared/hooks/useUrlFilters";
import { applyFacets } from "@/shared/utils/facets";

import { buildSpielFacets } from "../../facets";
import { formatQuelle } from "../../utils";
import { SpielCardsList } from "../collections/SpielCardsList";

import type { FLSpiel } from "../../schemas";

// Module scope: a fresh array defeats `useFuzzySearch`'s memo on every render. The
// `searchable_quelle` keys are here because a `quelle` holds no text, while the label
// DERIVED from it is what an unresolved bracket fixture shows.
const SEARCH_KEYS = [
  "team1.name",
  "team2.name",
  "searchable_team1_quelle",
  "searchable_team2_quelle",
  "ort.name",
  "ort.maps_link",
  "searchable_datum",
  "spiel_nr",
  "schiedsrichter.name",
] as const;

/**
 * Fuzzy search over a season's matches.
 *
 * `isAdmin` is how the public and the admin route share this whole view: the two differ by an edit link
 * per card and by nothing else, so a boolean carries the difference. It replaced an injected list
 * component, which was the right shape while the admin cards owned an edit modal's state and stopped
 * being one when the editor became a page of its own (ADR-0040).
 *
 * The list is filtered CLIENT-side over the season already fetched, not by re-querying the backend.
 * That is why the search feels instant and why it cannot find matches outside the selected season.
 */
export function SpielsucheView({ spiele, today, isAdmin = false }: { spiele: FLSpiel[]; today: string; isAdmin?: boolean }) {
  const { urlValue: spielQuery, inputValue, setInputValue } = useDebouncedUrlQuery();

  // Searchable copies of what a user types but the document does not store as text: a date typed
  // "14.03." against a stored `YYYY-MM-DD`, and a bracket slot's derived label against a reference.
  // The original fields stay, so both spellings match.
  const processedSpiele = useMemo(() => {
    return spiele.map((s) => ({
      ...s,
      searchable_datum: s.datum ? s.datum.split("-").reverse().join(".") : null,
      searchable_team1_quelle: formatQuelle(s.team1_quelle),
      searchable_team2_quelle: formatQuelle(s.team2_quelle),
    }));
  }, [spiele]);

  // The facets, rebuilt only when the season's fixtures change: three of them derive their options from
  // the fixtures themselves, so they cannot offer a club, venue or referee that would narrow to nothing.
  const facets = useMemo(() => buildSpielFacets({ spiele, today, isAdmin }), [spiele, today, isAdmin]);
  const { selection, activeCount } = useUrlFilters(facets);

  const narrowed = useMemo(() => applyFacets(processedSpiele, facets, selection), [processedSpiele, facets, selection]);

  // `emptyQuery: "all"`, because a FILTER is an input too: every cancelled fixture is
  // a legitimate thing to ask for without typing a word. The branch below decides
  // whether the page has been asked anything at all.
  const filteredResults = useFuzzySearch({
    items: narrowed,
    keys: SEARCH_KEYS,
    query: spielQuery,
    emptyQuery: "all",
  });

  const hasAsked = spielQuery !== "" || activeCount > 0;

  return (
    <div className="relative flex w-full flex-1 flex-col items-center">
      {/** Search bar and the filter control, in one sticky band: both narrow the same list, so a reader
           scrolling a long result set keeps both within reach. */}
      <div className="bg-background sticky top-0 z-20 flex w-full flex-col items-center gap-3 px-4 py-4 sm:px-8 lg:py-8">
        <SearchBar
          label="Spiele suchen"
          placeholder="Suche nach Team, Ort, Datum..."
          value={inputValue}
          onChange={setInputValue}
          className="max-w-toolbar w-full"
        />
        {/* Counted over the season's whole fixture list, so an option says what it would leave rather
            than what the current query already left. */}
        <div className="max-w-toolbar flex w-full flex-row justify-start">
          <FilterBar
            facets={facets}
            items={processedSpiele}
          />
        </div>
      </div>

      <div className="flex w-full flex-col items-center px-4 pb-4 sm:px-8">
        {!hasAsked ? (
          <p className="fluid-sm text-foreground-muted mt-10 font-bold tracking-wide italic">Noch keine Eingabe...</p>
        ) : filteredResults.length === 0 ? (
          <p className="fluid-sm text-foreground-muted mt-10 font-bold tracking-wide italic">
            {spielQuery === "" ? "Keine Ergebnisse für diese Filter" : `Keine Ergebnisse für "${spielQuery}"`}
          </p>
        ) : (
          // The cascade does more work here: results are re-filtered on every debounced keystroke,
          // so this grid re-enters constantly and a block fade reads as the previous set mutating
          // in place, its cards landing where the last set's were.
          <div
            role="list"
            className={`${CARDS_CASCADE} max-w-page grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3`}>
            <SpielCardsList
              spiele={filteredResults}
              today={today}
              isAdmin={isAdmin}
            />
          </div>
        )}
      </div>
    </div>
  );
}
