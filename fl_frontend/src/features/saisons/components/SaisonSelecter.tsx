"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Description, ListBox, Select } from "@heroui/react";

import { formatSpielDatum } from "@/shared/utils/format";

import type { Key } from "@heroui/react";
import type { FLSaison } from "../schemas";

export default function SaisonSelector({ seasons, currentSeason }: { seasons: FLSaison[]; currentSeason: FLSaison }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Determine active season from URL or fallback to current
  const activeSaisonId = searchParams.get("saison_id") || currentSeason.id;
  const activeSaisonData = seasons.find((s) => s.id === activeSaisonId) || currentSeason;

  const timespan = `${formatSpielDatum(activeSaisonData.start_date)} - ${formatSpielDatum(activeSaisonData.end_date)}`;

  const handleSelectionChange = (key: Key | null) => {
    if (!key) return;

    const selectedId = key.toString();
    const params = new URLSearchParams(searchParams.toString());

    if (selectedId && selectedId !== currentSeason.id) {
      params.set("saison_id", selectedId);
    } else {
      params.delete("saison_id");
    }

    router.replace(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="w-full">
      <Select
        aria-label="Saison auswählen"
        value={activeSaisonId}
        onChange={handleSelectionChange}
        className="w-full">
        {/* Sleek, single-layer trigger with interactive border states */}
        <Select.Trigger className="border-border/60 bg-surface/50 hover:bg-surface hover:border-border data-[open=true]:border-brand data-[open=true]:bg-surface flex h-auto min-h-14 w-full flex-row items-center justify-between rounded-xl border px-4 py-2.5 shadow-xs transition-all">
          <div className="flex flex-col items-start gap-0.5 text-left">
            <Select.Value className="text-fluid-lg! text-foreground font-black tracking-tight" />
            <Description className="text-fluid-xxs text-foreground-muted font-bold tracking-wider uppercase">{timespan}</Description>
          </div>

          <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
        </Select.Trigger>

        {/* Crisp popover matching the trigger's border radius */}
        <Select.Popover className="bg-surface border-border mt-2 rounded-xl border p-1.5 shadow-lg">
          <ListBox aria-label="Verfügbare Saisons">
            {seasons.map((saison) => (
              <ListBox.Item
                key={saison.id}
                id={saison.id}
                textValue={`Saison ${saison.id}`}
                className="text-foreground-muted hover:bg-muted/50 hover:text-brand text-fluid-sm rounded-lg px-3 py-2.5 font-bold transition-colors duration-100">
                Saison {saison.id}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  );
}
