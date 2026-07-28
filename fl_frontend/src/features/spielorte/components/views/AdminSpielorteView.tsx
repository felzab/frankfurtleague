"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Magnifier } from "@gravity-ui/icons";
import Fuse from "fuse.js";

import { Input } from "@heroui/react";

import AdminSpielorteTable from "../collections/AdminSpielorteTable";
import { AdminCreateSpielortModal } from "../modals/AdminCreateSpielortModal";
import { AdminDeleteSpielortModal } from "../modals/AdminDeleteSpielortModal";
import { AdminEditSpielortModal } from "../modals/AdminEditSpielortModal";

import type { FLSpielort } from "@/features/spielorte/schemas";

export function AdminSpielorteView({ spielorte }: { spielorte: FLSpielort[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const spielortQuery = searchParams.get("q") || "";
  const [inputValue, setInputValue] = useState(spielortQuery);
  const [editingOrt, setEditingOrt] = useState<FLSpielort | null>(null);
  const [deletingOrt, setDeletingOrt] = useState<FLSpielort | null>(null);

  // Sync local input if URL changes externally (e.g., browser back/forward buttons)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputValue(spielortQuery);
  }, [spielortQuery]);

  // Debouncing-Logic (Updates URL lazily after 300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (spielortQuery === inputValue) return;

      const params = new URLSearchParams(searchParams);
      if (inputValue) {
        params.set("q", inputValue);
      } else {
        params.delete("q");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, 300);

    return () => clearTimeout(timer);
  }, [inputValue, router, pathname, searchParams, spielortQuery]);

  const fuse = new Fuse(spielorte, {
    keys: ["name", "address.plz", "address.strasse", "address.stadtteil"],
    threshold: 0.3,
    distance: 100,
    ignoreLocation: true,
    minMatchCharLength: 1,
  });

  const filteredSpielorte = !spielortQuery ? spielorte : fuse.search(spielortQuery).map((result) => result.item);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-8 overflow-y-auto p-6 sm:p-8">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <h1 className="text-fluid-xl text-foreground font-extrabold tracking-tight">Spielorte</h1>
          <p className="text-fluid-sm text-foreground-muted mt-1 font-medium">Verwalte alle Austragungsorte und deren Infrastruktur.</p>
        </div>
        <AdminCreateSpielortModal />
      </div>

      {/* Toolbar / Search - Keeping the interactive focus design you liked */}
      <div className="bg-surface border-border focus-within:border-brand flex h-12 w-full max-w-md items-center gap-3 rounded-xl border px-4 py-2.5 shadow-sm transition-colors lg:h-15">
        <Magnifier
          className="text-foreground-muted shrink-0"
          width={18}
          height={18}
        />
        <Input
          type="text"
          value={inputValue}
          placeholder="Suchen nach Name, Straße, PLZ, Stadtteil..."
          variant="secondary"
          className="text-fluid-sm w-full border-none bg-transparent pl-0 outline-none focus-visible:ring-0 sm:pl-1"
          onChange={(e) => setInputValue(e.target.value)}
        />
      </div>

      <AdminSpielorteTable
        spielortQuery={spielortQuery}
        filteredSpielorte={filteredSpielorte}
        setEditingOrt={setEditingOrt}
        setDeletingOrt={setDeletingOrt}
      />

      <AdminEditSpielortModal
        ortData={editingOrt}
        isOpen={editingOrt !== null}
        onClose={() => setEditingOrt(null)}
      />

      <AdminDeleteSpielortModal
        ortData={deletingOrt}
        isOpen={deletingOrt !== null}
        onClose={() => setDeletingOrt(null)}
      />
    </div>
  );
}
