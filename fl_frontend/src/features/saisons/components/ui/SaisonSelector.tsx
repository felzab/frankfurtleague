"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Description, ListBox, Select } from "@heroui/react";

import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { SaisonSlotSkeleton } from "@/shared/components/ui/SaisonSlotSkeleton";
import { useMounted } from "@/shared/hooks/useMounted";
import { useNavigationClosedOverlay } from "@/shared/hooks/useNavigationClosedOverlay";
import { formatSpielDatum } from "@/shared/utils/format";

import type { Key } from "@heroui/react";
import type { FLSaison } from "../../schemas";

export function SaisonSelector({ saisons, currentSaison }: { saisons: FLSaison[]; currentSaison: FLSaison }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isMounted = useMounted();
  const [isSwitching, startSwitching] = useTransition();

  // The popover's open state is OURS: a client-side navigation is not an outside interaction, so an
  // uncontrolled popover stays logically open with nothing on screen.
  const { isOpen, setIsOpen } = useNavigationClosedOverlay();

  // Validated against the list, never taken raw from the user-editable `?saison_id=`: an unknown id
  // shows nothing selected while the range below falls back to the current season.
  const requestedSaisonId = searchParams.get("saison_id");
  const activeSaisonData = saisons.find((saison) => saison.id === requestedSaisonId) ?? currentSaison;
  const activeSaisonId = activeSaisonData.id;

  // A bis-Strich rather than the word, which the trigger's `uppercase` renders as "BIS".
  const timespan = `${formatSpielDatum(activeSaisonData.start_date)} – ${formatSpielDatum(activeSaisonData.end_date)}`;

  const handleSelectionChange = (key: Key | null) => {
    if (!key) return;

    const selectedId = key.toString();
    const params = new URLSearchParams(searchParams.toString());

    // The current season is the backend's default, so it is the ABSENCE of the parameter rather than
    // a value. Keeps the common URL clean and shareable.
    if (selectedId !== currentSaison.id) {
      params.set("saison_id", selectedId);
    } else {
      params.delete("saison_id");
    }

    // Closed explicitly: `useNavigationClosedOverlay` watches the pathname, and switching season
    // changes only the query string.
    setIsOpen(false);

    // In a transition, so React keeps the page interactive rather than replacing streamed-in regions
    // with their fallbacks.
    startSwitching(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  // Until React attaches, the trigger below is inert: this streams in as finished markup long before
  // hydration reaches it. The server renders this branch too, so there is no mismatch.
  if (!isMounted) return <SaisonSlotSkeleton />;

  return (
    <div className="w-full">
      <Select
        aria-label="Saison auswählen"
        value={activeSaisonId}
        onChange={handleSelectionChange}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        className="w-full">
        <Select.Trigger
          // `aria-busy` while the new season's data is in flight: a season switch is a server
          // round-trip, so without the dimming the only feedback is the page changing later.
          aria-busy={isSwitching}
          // Brand border ONLY while open: react-aria hands focus back to this trigger on dismiss, so
          // the field-focus rule's focus arms in `globals.css` would hold it after an outside click.
          data-border-on-open="true"
          // No `aria-expanded:border-brand` here: `globals.css`'s field-focus block already paints
          // every field-shaped control, and a second copy at one call site is how they diverge.
          className={`border-border/60 bg-surface/50 data-hovered:bg-hover data-hovered:border-border aria-expanded:bg-surface flex h-auto min-h-14 w-full flex-row items-center justify-between rounded-xl border px-4 py-2.5 shadow-xs transition-[background-color,border-color,opacity] duration-200 ${
            isSwitching ? "opacity-60" : ""
          }`}>
          <div className="flex flex-col items-start gap-0.5 text-left">
            {/* Rendered from `activeSaisonId`, NOT from `Select.Value`, which resolves its label
                out of the react-aria collection and shows HeroUI's English placeholder on a render
                where the collection has not committed. */}
            <span className="fluid-lg text-foreground font-black tracking-tight">{`Saison ${activeSaisonId}`}</span>
            <Description className="fluid-xxs text-foreground-muted font-bold tracking-wider uppercase">{timespan}</Description>
          </div>

          <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
        </Select.Trigger>

        <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
          <ListBox aria-label="Verfügbare Saisons">
            {saisons.map((saison) => (
              <ListBox.Item
                key={saison.id}
                id={saison.id}
                textValue={`Saison ${saison.id}`}
                className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
                Saison {saison.id}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  );
}
