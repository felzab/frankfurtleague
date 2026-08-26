"use client";

import { useMemo } from "react";

import { FilterLeiste } from "@/shared/components/ui/FilterLeiste";
import { CARDS_CASCADE } from "@/shared/components/ui/motion";
import { SearchBar } from "@/shared/components/ui/SearchBar";
import { useDebouncedUrlQuery } from "@/shared/hooks/useDebouncedUrlQuery";
import { useFacetSelection } from "@/shared/hooks/useFacetSelection";
import { useFuzzySearch } from "@/shared/hooks/useFuzzySearch";
import { applyFacets, countActiveFacets } from "@/shared/utils/facets";

import { buildSpielFacets } from "../../facets";
import { formatQuelle } from "../../utils";
import { SpielCardsList } from "../collections/SpielCardsList";

import type { FLSpiel } from "../../schemas";

// Module scope: a fresh array defeats `useFuzzySearch`'s memo. The `searchable_quelle` keys exist
// because a `quelle` holds no text, while the label derived from it is what a reader sees.
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
 * `isAdmin` is how the public and admin routes share this view, the two differing by an edit link
 * per card. Filtered CLIENT-side over the season already fetched, so it cannot find a match outside
 * the selected season.
 */
export function SpielsucheView({
  spiele,
  today,
  isAdmin = false,
  spieltage,
}: {
  spiele: FLSpiel[];
  today: string;
  isAdmin?: boolean;
  /**
   * The season's matchdays, labelled, for the facet of the same name. Absent on a route that fetched
   * none, and `fl_frontend/src/features/spiele/facets.ts :: buildSpielFacets` then omits the facet.
   */
  spieltage?: readonly { id: string; label: string }[];
}) {
  const { urlValue: spielQuery, inputValue, setInputValue } = useDebouncedUrlQuery();

  // Copies of what a user types but the document does not store as text — a date as "14.03."
  // against a stored `YYYY-MM-DD`. The originals stay, so both spellings match.
  const processedSpiele = useMemo(() => {
    return spiele.map((s) => ({
      ...s,
      searchable_datum: s.datum ? s.datum.split("-").reverse().join(".") : null,
      searchable_team1_quelle: formatQuelle(s.team1_quelle),
      searchable_team2_quelle: formatQuelle(s.team2_quelle),
    }));
  }, [spiele]);

  // Three facets derive their options from the fixtures, so none of those can offer a value narrowing
  // to nothing. `spieltag` is the exception, and reads zero for a matchday nothing is drawn into yet.
  const facets = useMemo(() => buildSpielFacets({ spiele, today, isAdmin, spieltage }), [spiele, today, isAdmin, spieltage]);
  // The controls are `FilterLeiste`'s and they meet this side in the URL, so it only reads.
  const selection = useFacetSelection(facets);

  const narrowed = useMemo(() => applyFacets(processedSpiele, facets, selection), [processedSpiele, facets, selection]);

  // `emptyQuery: "all"`, a FILTER being an input too: asking for every cancelled fixture takes no
  // typing. The branch below decides whether the page was asked anything at all.
  const filteredResults = useFuzzySearch({
    items: narrowed,
    keys: SEARCH_KEYS,
    query: spielQuery,
    emptyQuery: "all",
  });

  const hasAsked = spielQuery !== "" || countActiveFacets(selection) > 0;
  // Rather than `filteredResults`, which answers "everything" for a page nobody has asked yet.
  const shown = hasAsked ? filteredResults : [];

  const message = !hasAsked
    ? "Noch keine Eingabe..."
    : shown.length === 0
      ? spielQuery === ""
        ? "Keine Ergebnisse für diese Filter"
        : `Keine Ergebnisse für "${spielQuery}"`
      : null;

  return (
    <div className="relative flex w-full flex-1 flex-col items-center">
      {/* One sticky band: both narrow the same list, so a reader
           scrolling a long result set keeps both within reach. */}
      <div className="bg-background sticky top-0 z-20 flex w-full flex-col items-center gap-3 px-4 py-4 sm:px-8 lg:py-8">
        <SearchBar
          label="Spiele suchen"
          placeholder="Suche nach Team, Ort, Datum..."
          value={inputValue}
          onChange={setInputValue}
          className="max-w-toolbar w-full"
        />
        {/* Counted over the whole season, so an option says what it would leave rather
            than what the current query already left. */}
        <div className="max-w-toolbar flex w-full flex-row justify-start">
          <FilterLeiste
            facets={facets}
            items={processedSpiele}
          />
        </div>
      </div>

      <div className="flex w-full flex-col items-center px-4 pb-4 sm:px-8">
        {message !== null && <p className="fluid-sm text-foreground-muted mt-10 font-bold tracking-wide italic">{message}</p>}

        {/* ALWAYS mounted, an empty grid being a zero-height box. A third branch beside the two
            messages is rebuilt whenever a query crosses "nothing found" to "something found",
            replaying every surviving card's entrance for one row. */}
        <div
          role="list"
          className={`${CARDS_CASCADE} max-w-page grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3`}>
          <SpielCardsList
            spiele={shown}
            today={today}
            isAdmin={isAdmin}
          />
        </div>
      </div>
    </div>
  );
}
