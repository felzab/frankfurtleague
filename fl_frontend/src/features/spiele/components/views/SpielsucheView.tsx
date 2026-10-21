"use client";

import { useMemo, useState } from "react";

import { groupBestaetigungenBySpielId } from "@/features/spielbestaetigungen/utils";
import { Callout } from "@/shared/components/ui/Callout";
import { FilterLeiste } from "@/shared/components/ui/FilterLeiste";
import { CARDS_CASCADE_CLASSES } from "@/shared/components/ui/motion";
import { SearchBar } from "@/shared/components/ui/SearchBar";
import { useFacetSelection } from "@/shared/hooks/useFacetSelection";
import { useFuzzySearch } from "@/shared/hooks/useFuzzySearch";
import { applyFacets, countActiveFacets } from "@/shared/utils/facets";
import { formatSpielDatum } from "@/shared/utils/format";

import { buildSpielFacets } from "../../facets";
import { formatQuelle } from "../../utils";
import { SpielCardsList } from "../collections/SpielCardsList";
import { SpielCardGrid } from "../ui/SpielCardGrid";

import type { FLSpielbestaetigung } from "@/features/spielbestaetigungen/schemas";
import type { SaisonBestaetigungen } from "@/features/spielbestaetigungen/types";
import type { FLSpiel } from "../../schemas";

// Module scope: a fresh array defeats `useFuzzySearch`'s memo. The `searchable_team1_quelle` and
// `searchable_team2_quelle` keys exist because a `quelle` holds no text, while the label derived from
// it is what a reader sees.
const KEINE_AUSTRITTE: Readonly<Record<string, string>> = {};

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
  isFinishedSaison,
  spieltage,
  teams,
  spielorte,
  schiedsrichter,
  bestaetigungen,
  bestaetigungenVollstaendig = true,
  austritte = KEINE_AUSTRITTE,
}: {
  spiele: FLSpiel[];
  today: string;
  isAdmin?: boolean;
  isFinishedSaison: boolean;
  /**
   * The season's matchdays, labelled, for the facet of the same name. Absent on a route that fetched
   * none, and `fl_frontend/src/features/spiele/facets.ts :: buildSpielFacets` then omits the facet.
   */
  spieltage?: readonly { id: string; label: string }[];
  /** What `buildSpielFacets` labels a linked value with; absent where the route's tier reads no such list. */
  teams?: readonly { id: string; name: string }[];
  spielorte?: readonly { id: string; name: string }[];
  schiedsrichter?: readonly { id: string; name: string | null }[];
  /**
   * The season's confirmation rows, an administrator's read: absent on the public route, `null` where the read failed,
   * which the page says rather than showing cards that read as asked nothing.
   */
  bestaetigungen?: readonly FLSpielbestaetigung[] | null;
  bestaetigungenVollstaendig?: boolean;
  /** The day each club left this season, by `team_id`, where it has: the pass ends a row of a club gone by its day. */
  austritte?: Readonly<Record<string, string>>;
}) {
  // Held here, the one ancestor of both the bar and the list, and never in the URL: the search
  // reaches a referee's name (`docs/frontend/spec.md :: I680`).
  const [spielQuery, setSpielQuery] = useState("");

  // A reader types the spelling they have seen, so the rendered date is the only one `SEARCH_KEYS` names.
  // Formatting it through the site's own date helper is what keeps the searched spelling on the rendered one.
  const processedSpiele = useMemo(() => {
    return spiele.map((s) => ({
      ...s,
      searchable_datum: s.datum === null ? null : formatSpielDatum(s.datum),
      searchable_team1_quelle: formatQuelle(s.team1_quelle),
      searchable_team2_quelle: formatQuelle(s.team2_quelle),
    }));
  }, [spiele]);

  // A facet's zero is not "nothing to find": `spieltag` reads it for a matchday nothing is drawn into
  // yet, and a club, venue or referee a link names reads it where no fixture here holds one.
  const facets = useMemo(
    () => buildSpielFacets({ spiele, today, isAdmin, spieltage, teams, spielorte, schiedsrichter }),
    [spiele, today, isAdmin, spieltage, teams, spielorte, schiedsrichter],
  );
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

  const saisonBestaetigungen = useMemo(
    (): SaisonBestaetigungen | undefined =>
      bestaetigungen === undefined || bestaetigungen === null
        ? undefined
        : { bySpielId: groupBestaetigungenBySpielId(bestaetigungen), austritte: new Map(Object.entries(austritte)) },
    [bestaetigungen, austritte],
  );

  const hasAsked = spielQuery !== "" || countActiveFacets(selection) > 0;
  // Rather than `filteredResults`, which answers "everything" for a page nobody has asked yet.
  const shown = hasAsked ? filteredResults : [];

  const message = !hasAsked
    ? "Suche nach einem Spiel oder setze einen Filter."
    : shown.length === 0
      ? spielQuery === ""
        ? "Keine Spiele für diese Filter."
        : `Keine Spiele für „${spielQuery}“.`
      : null;

  return (
    <div className="relative flex w-full flex-1 flex-col items-center">
      {/* One sticky band: both narrow the same list, so a reader
           scrolling a long result set keeps both within reach. */}
      <div className="sticky top-0 z-20 flex w-full flex-col items-center gap-3 bg-background px-4 py-4 sm:px-8 lg:py-8">
        <SearchBar
          label="Spiele suchen"
          placeholder="z.B. Sportpark Nord oder 14.03."
          value={spielQuery}
          onChange={setSpielQuery}
          className="w-full max-w-toolbar"
        />
        {/* Counted over the whole season, so an option says what it would leave rather
            than what the current query already left. */}
        <div className="flex w-full max-w-toolbar flex-row justify-start">
          <FilterLeiste
            facets={facets}
            items={processedSpiele}
          />
        </div>
      </div>

      <div className="flex w-full flex-col items-center px-4 pb-4 sm:px-8">
        {/* Standing, never dismissible: a card short of its chips reads as a fixture nobody asked. A cut reaches the
            closed rows alone, and of those a card chips a referee's decline. */}
        {(bestaetigungen === null || !bestaetigungenVollstaendig) && (
          <div className="flex w-full max-w-toolbar flex-col">
            <Callout
              severity="warning"
              title={
                bestaetigungen === null ? "Die Spielbestätigungen ließen sich gerade nicht lesen" : "Die Spielbestätigungen sind unvollständig"
              }>
              {bestaetigungen === null
                ? "Die Karten zeigen deshalb keine Antworten, weder der Teams noch ihrer Schiedsrichterin oder ihres Schiedsrichters. Lade die Seite neu."
                : "Geladen sind alle offenen Anfragen dieser Saison, von den geschlossenen nur die neuesten. Einer Karte kann deshalb die Absage ihrer Schiedsrichterin oder ihres Schiedsrichters fehlen."}
            </Callout>
          </div>
        )}

        {message !== null && <p className="mt-10 fluid-sm font-bold tracking-wide text-foreground-muted italic">{message}</p>}

        {/* ALWAYS mounted, an empty grid being a zero-height box. A third branch beside the two
            messages is rebuilt whenever a query crosses "nothing found" to "something found",
            replaying every surviving card's entrance for one row. */}
        <SpielCardGrid
          role="list"
          className={CARDS_CASCADE_CLASSES}>
          <SpielCardsList
            spiele={shown}
            today={today}
            isAdmin={isAdmin}
            isFinishedSaison={isFinishedSaison}
            bestaetigungen={saisonBestaetigungen}
          />
        </SpielCardGrid>
      </div>
    </div>
  );
}
