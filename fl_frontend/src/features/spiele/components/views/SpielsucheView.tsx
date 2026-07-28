"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Magnifier } from "@gravity-ui/icons";
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

  // Sync local input if URL changes externally (e.g., browser back/forward buttons)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputValue(spielQuery);
  }, [spielQuery]);

  // 1. Debouncing-Logic (Updates URL lazily after 300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (spielQuery === inputValue) return;

      const params = new URLSearchParams(searchParams);
      if (inputValue) {
        params.set("q", inputValue);
      } else {
        params.delete("q");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, 300);

    return () => clearTimeout(timer);
  }, [inputValue, router, pathname, searchParams, spielQuery]);

  const processedSpiele = useMemo(() => {
    return spiele.map((s) => ({
      ...s,
      searchable_datum: s.datum ? s.datum.split("-").reverse().join(".") : null,
    }));
  }, [spiele]);

  // 2. Fuse.js configuration
  const fuse = useMemo(() => {
    return new Fuse(processedSpiele, {
      keys: ["team1.name", "team2.name", "ort.name", "ort.maps_link", "searchable_datum", "spiel_nr", "schiedsrichter.name"],
      threshold: 0.3,
      distance: 100,
      ignoreLocation: true,
      minMatchCharLength: 1,
    });
  }, [processedSpiele]);

  // 3. Filtering driven strictly by spielQuery (the URL source of truth)
  const filteredResults = useMemo(() => {
    if (!spielQuery) return [];
    return fuse.search(spielQuery).map((result) => result.item);
  }, [spielQuery, fuse]);

  return (
    <div className="relative flex w-full flex-1 flex-col items-center">
      {/** Search Bar */}
      <div className="bg-background sticky top-0 z-20 flex w-full justify-center px-4 py-4 sm:px-8 lg:py-8">
        {/* The Visual Search Bar Wrapper */}
        <div className="bg-surface border-border focus-within:border-brand flex h-12 w-full max-w-[1200px] items-center gap-3 rounded-xl border px-4 shadow-sm transition-colors lg:h-15">
          <Magnifier
            className="text-foreground-muted shrink-0"
            width={20}
            height={20}
          />

          <Input
            type="text"
            value={inputValue}
            placeholder="Suche nach Team, Ort, Datum..."
            variant="secondary"
            className="text-fluid-sm placeholder:text-foreground-muted/70 w-full border-none bg-transparent font-bold outline-none focus-visible:ring-0"
            onChange={(e) => setInputValue(e.target.value)}
          />
        </div>
      </div>

      {/* Results Area */}
      <div className="flex w-full flex-col items-center px-4 pb-4 sm:px-8">
        {spielQuery === "" ? (
          <p className="text-fluid-sm text-foreground-muted mt-10 font-bold tracking-wide italic">Noch keine Eingabe...</p>
        ) : filteredResults.length === 0 ? (
          <p className="text-fluid-sm text-foreground-muted mt-10 font-bold tracking-wide italic">Keine Ergebnisse für "{spielQuery}"</p>
        ) : (
          <div className="animate-in fade-in slide-in-from-bottom-4 grid w-full max-w-[1400px] grid-cols-1 gap-5 duration-400 sm:grid-cols-2 xl:grid-cols-3">
            <ListComponent spiele={filteredResults} />
          </div>
        )}
      </div>
    </div>
  );
}
