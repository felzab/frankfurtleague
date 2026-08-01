"use client";

import { useMemo } from "react";

import { SearchBar } from "@/shared/components/ui/SearchBar";
import { useDebouncedUrlQuery } from "@/shared/hooks/useDebouncedUrlQuery";
import { useFuzzySearch } from "@/shared/hooks/useFuzzySearch";

import type { FLSpiel } from "../../schemas";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render.
const SEARCH_KEYS = ["team1.name", "team2.name", "ort.name", "ort.maps_link", "searchable_datum", "spiel_nr", "schiedsrichter.name"] as const;

/**
 * Fuzzy search over a season's matches.
 *
 * `ListComponent` is injected rather than imported so the public and admin routes can share this whole
 * view while rendering different cards — the admin one opens an edit modal, the public one does not.
 *
 * The list is filtered CLIENT-side over the season already fetched, not by re-querying the backend.
 * That is why the search feels instant and why it cannot find matches outside the selected season.
 */
export function SpielsucheView({
  spiele,
  today,
  ListComponent,
}: {
  spiele: FLSpiel[];
  today: string;
  ListComponent: React.ComponentType<{ spiele: FLSpiel[]; today: string }>;
}) {
  const { urlValue: spielQuery, inputValue, setInputValue } = useDebouncedUrlQuery();

  // Adds a German-formatted copy of the date purely so it can be searched. Dates are stored and
  // rendered as `YYYY-MM-DD`, but a user typing a date types "14.03." — searching the stored form
  // would find nothing for the format they are actually looking at. The original field stays, so both
  // spellings match.
  const processedSpiele = useMemo(() => {
    return spiele.map((s) => ({
      ...s,
      searchable_datum: s.datum ? s.datum.split("-").reverse().join(".") : null,
    }));
  }, [spiele]);

  // `emptyQuery: "none"` is deliberate and the reason the hook takes the option at all: this view
  // shows "Noch keine Eingabe..." until the user types, while the two admin views list everything.
  const filteredResults = useFuzzySearch({
    items: processedSpiele,
    keys: SEARCH_KEYS,
    query: spielQuery,
    emptyQuery: "none",
  });

  return (
    <div className="relative flex w-full flex-1 flex-col items-center">
      {/* These routes have no visible page title by design, so the `h1` that anchors the heading
          list is visually hidden. The text matches the route's own `metadata.title` (R4 §4.2). */}
      <h1 className="sr-only">Spielsuche</h1>

      {/** Search Bar */}
      <div className="bg-background sticky top-0 z-20 flex w-full justify-center px-4 py-4 sm:px-8 lg:py-8">
        <SearchBar
          label="Spiele suchen"
          placeholder="Suche nach Team, Ort, Datum..."
          value={inputValue}
          onChange={setInputValue}
          className="max-w-toolbar w-full"
        />
      </div>

      {/* Results Area */}
      <div className="flex w-full flex-col items-center px-4 pb-4 sm:px-8">
        {spielQuery === "" ? (
          <p className="text-fluid-sm text-foreground-muted mt-10 font-bold tracking-wide italic">Noch keine Eingabe...</p>
        ) : filteredResults.length === 0 ? (
          <p className="text-fluid-sm text-foreground-muted mt-10 font-bold tracking-wide italic">Keine Ergebnisse für "{spielQuery}"</p>
        ) : (
          <div
            role="list"
            className="animate-in fade-in slide-in-from-bottom-4 max-w-page grid w-full grid-cols-1 gap-5 duration-400 sm:grid-cols-2 xl:grid-cols-3">
            <ListComponent
              spiele={filteredResults}
              today={today}
            />
          </div>
        )}
      </div>
    </div>
  );
}
