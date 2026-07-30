"use client";

import { useState } from "react";

import { Magnifier } from "@gravity-ui/icons";

import { Input } from "@heroui/react";

import { useDebouncedUrlQuery } from "@/shared/hooks/useDebouncedUrlQuery";
import { useFuzzySearch } from "@/shared/hooks/useFuzzySearch";

import AdminSpielorteTable from "../collections/AdminSpielorteTable";
import { AdminCreateSpielortModal } from "../modals/AdminCreateSpielortModal";
import { AdminDeleteSpielortModal } from "../modals/AdminDeleteSpielortModal";
import { AdminEditSpielortModal } from "../modals/AdminEditSpielortModal";

import type { FLSpielort } from "@/features/spielorte/schemas";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render.
const SEARCH_KEYS = ["name", "address.plz", "address.strasse", "address.stadtteil"] as const;

export function AdminSpielorteView({ spielorte }: { spielorte: FLSpielort[] }) {
  const { urlValue: spielortQuery, inputValue, setInputValue } = useDebouncedUrlQuery();
  const [editingOrt, setEditingOrt] = useState<FLSpielort | null>(null);
  const [deletingOrt, setDeletingOrt] = useState<FLSpielort | null>(null);

  const filteredSpielorte = useFuzzySearch({ items: spielorte, keys: SEARCH_KEYS, query: spielortQuery });

  return (
    <div className="max-w-page mx-auto flex h-full w-full flex-col gap-8 overflow-y-auto p-6 sm:p-8">
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
