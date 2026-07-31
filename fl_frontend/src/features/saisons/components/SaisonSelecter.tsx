"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Description, ListBox, Select } from "@heroui/react";

import { overlayPanel } from "@/shared/components/ui/overlayPanel";
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
        <Select.Trigger className="border-border/60 bg-surface/50 hover:bg-surface hover:border-border aria-expanded:border-brand aria-expanded:bg-surface flex h-auto min-h-14 w-full flex-row items-center justify-between rounded-xl border px-4 py-2.5 shadow-xs transition-colors duration-200">
          <div className="flex flex-col items-start gap-0.5 text-left">
            {/* Rendered from `activeSaisonId`, NOT from `Select.Value`.
                `Select.Value` resolves its label out of the react-aria collection, so any render
                where the collection has not committed shows HeroUI's English "Select an item"
                placeholder instead — intermittently, and only for the name, which is exactly the
                reported symptom: the timespan below stayed correct because it reads the same prop
                this now does. Both halves of the trigger come from one source and cannot disagree. */}
            <span className="text-fluid-lg text-foreground font-black tracking-tight">
              {activeSaisonId ? `Saison ${activeSaisonId}` : "Saison wählen"}
            </span>
            <Description className="text-fluid-xxs text-foreground-muted font-bold tracking-wider uppercase">{timespan}</Description>
          </div>

          <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
        </Select.Trigger>

        {/* Crisp popover matching the trigger's border radius */}
        <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
          <ListBox aria-label="Verfügbare Saisons">
            {seasons.map((saison) => (
              <ListBox.Item
                key={saison.id}
                id={saison.id}
                textValue={`Saison ${saison.id}`}
                className="text-foreground-muted hover:bg-muted/40 hover:text-brand text-fluid-sm rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
                Saison {saison.id}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  );
}
