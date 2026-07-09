"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { ListBox, Select } from "@heroui/react";

import type { Key } from "@heroui/react";
import type { FLSaison } from "../schemas";

export default function SaisonSelector({ seasons, currentSeason }: { seasons: FLSaison[]; currentSeason: FLSaison }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 1. Determine active season from URL or fallback to current
  const activeSaisonId = searchParams.get("saison_id") || currentSeason.id;

  // 2. Find the active season data for the timespan display
  const activeSaisonData = seasons.find((s) => s.id === activeSaisonId) || currentSeason;
  const timespan = `${new Date(activeSaisonData.start_date).toLocaleDateString("de-DE")} - ${new Date(activeSaisonData.end_date).toLocaleDateString("de-DE")}`;

  // 3. HeroUI v3 strict onChange handler (receives Key | null for single selection)
  const handleSelectionChange = (key: Key | null) => {
    // Prevent clearing the selection entirely
    if (!key) return;

    const selectedId = key.toString();
    const params = new URLSearchParams(searchParams.toString());

    // Clean URL logic: Only set the parameter if they pick a historical season
    if (selectedId && selectedId !== currentSeason.id) {
      params.set("saison_id", selectedId);
    } else {
      params.delete("saison_id");
    }

    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex h-[80px] flex-col items-start justify-start px-4 py-2">
      <Select
        aria-label="Saison auswählen"
        value={activeSaisonId}
        onChange={handleSelectionChange}
        className="font-secondary w-full font-bold">
        <Select.Trigger className="hover:bg-default-100 border-none bg-transparent px-0 shadow-none">
          <Select.Value className="font-secondary text-lg/6 font-bold" />
          <Select.Indicator />
        </Select.Trigger>

        <Select.Popover>
          <ListBox aria-label="Verfügbare Saisons">
            {seasons.map((saison) => (
              <ListBox.Item
                key={saison.id}
                id={saison.id}
                textValue={`Saison ${saison.id}`}>
                Saison {saison.id}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <p className="text-fluid-xxs font-secondary -mt-[10px]">{timespan}</p>
    </div>
  );
}
