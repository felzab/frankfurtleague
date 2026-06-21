"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import Fuse from "fuse.js";

import { Input } from "@heroui/react";

import type { FLSpiel } from "../../schemas";

export default function SpielsucheView({
  spiele,
  ListComponent,
}: {
  spiele: FLSpiel[];
  ListComponent: React.ComponentType<{ spiele: FLSpiel[] }>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const spielQuery = searchParams.get("q") || "";
  const [inputValue, setInputValue] = useState(spielQuery);

  // 1. Debouncing-Logic
  useEffect(() => {
    const timer = setTimeout(() => {
      // Guard-clause, so that the component is not rerendered constantly
      const spielQuery = searchParams.get("q") || "";
      if (spielQuery === inputValue) return;

      const params = new URLSearchParams(searchParams);
      if (inputValue) {
        params.set("q", inputValue);
      } else {
        params.delete("q");
      }
      // Update URL without reloading the page
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, 300); // Wait 300ms

    return () => clearTimeout(timer); // Clean up, in case the user starts typing again
  }, [inputValue, router, pathname, searchParams]);

  const processedSpiele = spiele.map((s) => ({
    ...s,
    // Changes the date format to DD.MM.YYYY
    searchable_datum: s.datum ? s.datum.split("-").reverse().join(".") : null,
  }));

  // 2. Fuse.js configuration:
  const fuse = useMemo(() => {
    return new Fuse(processedSpiele, {
      keys: ["team1.name", "team2.name", "ort", "searchable_datum", "spiel_nr"],
      threshold: 0.4,
      distance: 100,
      ignoreLocation: true,
      minMatchCharLength: 1,
    });
  }, [processedSpiele]);

  // 3. Filtering:
  const filteredResults = useMemo(() => {
    if (!spielQuery) return spiele;
    return fuse.search(spielQuery).map((result) => result.item);
  }, [spielQuery, spiele, fuse]);

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-start px-2 py-1">
      <Input
        type="text"
        value={inputValue}
        placeholder="Suche nach Team, Ort, Datum..."
        className="border-quaternary-light dark:border-quaternary-dark bg-primary-light dark:bg-secondary-dark sticky h-fit w-full max-w-[1200px] rounded-lg border-1 p-3 outline-none focus-within:!ring-0 focus-within:!ring-offset-0 lg:w-[90%]"
        onChange={(e) => setInputValue(e.target.value)}
      />

      <div className="scrollbar-hide flex min-h-full w-full flex-col items-center justify-start overflow-y-scroll pt-4">
        {inputValue === "" ? <p className="text-center">Noch keine Eingabe...</p> : <ListComponent spiele={filteredResults} />}

        {filteredResults.length === 0 && <p className="text-center">Keine Ergebnisse für "{spielQuery}"</p>}
      </div>
    </div>
  );
}
