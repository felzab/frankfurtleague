"use client";

import { useState } from "react";

import { SearchBar } from "@/shared/components/ui/SearchBar";
import { useDebouncedUrlQuery } from "@/shared/hooks/useDebouncedUrlQuery";
import { useFuzzySearch } from "@/shared/hooks/useFuzzySearch";

import AdminSchiedsrichterTable from "../collections/AdminSchiedsrichterTable";
import { AdminCreateSchiedsrichterModal } from "../modals/AdminCreateSchiedsrichterModal";
import { AdminDeleteSchiedsrichterModal } from "../modals/AdminDeleteSchiedsrichterModal";
import { AdminEditSchiedsrichterModal } from "../modals/AdminEditSchiedsrichterModal";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render.
const SEARCH_KEYS = ["name", "schule", "kontakt.email", "kontakt.telefon"] as const;

export function AdminSchiedsrichterView({ schiedsrichter }: { schiedsrichter: FLSchiedsrichter[] }) {
  const { urlValue: schiedsrichterQuery, inputValue, setInputValue } = useDebouncedUrlQuery();
  const [editingSchiedsrichter, setEditingSchiedsrichter] = useState<FLSchiedsrichter | null>(null);
  const [deletingSchiedsrichter, setDeletingSchiedsrichter] = useState<FLSchiedsrichter | null>(null);

  const filteredSchiedsrichter = useFuzzySearch({ items: schiedsrichter, keys: SEARCH_KEYS, query: schiedsrichterQuery });

  return (
    <div className="max-w-page mx-auto flex h-full w-full flex-col gap-8 overflow-y-auto p-6 sm:p-8">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <h1 className="text-fluid-xl text-foreground font-extrabold tracking-tight">Schiedsrichter</h1>
          <p className="text-fluid-sm text-foreground-muted mt-1 font-medium">Verwalte alle Schiedsrichter, deren Kontaktdaten und Honorare.</p>
        </div>
        <AdminCreateSchiedsrichterModal />
      </div>

      <SearchBar
        label="Schiedsrichter suchen"
        placeholder="Suchen nach Name, Schule, E-Mail..."
        value={inputValue}
        onChange={setInputValue}
        className="w-full max-w-md"
      />

      <AdminSchiedsrichterTable
        schiedsrichterQuery={schiedsrichterQuery}
        filteredSchiedsrichter={filteredSchiedsrichter}
        setEditingSchiedsrichter={setEditingSchiedsrichter}
        setDeletingSchiedsrichter={setDeletingSchiedsrichter}
      />

      <AdminEditSchiedsrichterModal
        schiedsrichterData={editingSchiedsrichter}
        isOpen={editingSchiedsrichter !== null}
        onClose={() => setEditingSchiedsrichter(null)}
      />

      <AdminDeleteSchiedsrichterModal
        schiedsrichterData={deletingSchiedsrichter}
        isOpen={deletingSchiedsrichter !== null}
        onClose={() => setDeletingSchiedsrichter(null)}
      />
    </div>
  );
}
