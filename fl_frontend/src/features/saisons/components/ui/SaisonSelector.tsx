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

  // The popover's open state is OURS. A client-side navigation is not an outside
  // interaction, so an uncontrolled popover stays logically OPEN across one with
  // nothing on screen, and the trigger then reads as dead while toggling.
  const { isOpen, setIsOpen } = useNavigationClosedOverlay();

  // Validated against the list, never taken raw from the user-editable `?saison_id=`:
  // an unknown id shows nothing selected while the range below falls back to the
  // current season. `resolveSaisonId` strips it server-side (ADR-0055).
  const requestedSaisonId = searchParams.get("saison_id");
  const activeSaisonData = saisons.find((saison) => saison.id === requestedSaisonId) ?? currentSaison;
  const activeSaisonId = activeSaisonData.id;

  const timespan = `${formatSpielDatum(activeSaisonData.start_date)} - ${formatSpielDatum(activeSaisonData.end_date)}`;

  const handleSelectionChange = (key: Key | null) => {
    if (!key) return;

    const selectedId = key.toString();
    const params = new URLSearchParams(searchParams.toString());

    // The current season is the backend's default (ADR-0002), so it is represented by the ABSENCE of the
    // parameter rather than by its value. Keeps the common URL clean and shareable.
    if (selectedId !== currentSaison.id) {
      params.set("saison_id", selectedId);
    } else {
      params.delete("saison_id");
    }

    // Closed explicitly. `useNavigationClosedOverlay` watches the *pathname*, and switching season
    // changes only the query string -- so this is the one exit route the hook cannot cover.
    setIsOpen(false);

    // In a transition, so React keeps the current page interactive while the new season's data is
    // fetched rather than replacing streamed-in regions with their fallbacks -- the sidemenu's own
    // skeletons, this control's included.
    startSwitching(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  // Until React attaches to this subtree the trigger below is inert: the selector streams in as
  // finished markup long before hydration reaches it, and a press in that window opens nothing. The
  // server renders this branch too, so there is no mismatch.
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
          // `aria-busy` while the new season's data is in flight, and the dimming tells a sighted
          // user the press landed — a season switch is a server round-trip, so without it the only
          // feedback is the page changing some time later.
          aria-busy={isSwitching}
          // Brand border ONLY while open: react-aria hands focus back to this trigger when the
          // popover dismisses, so the field-focus rule's focus arms would hold the border after an
          // outside click. This marker opts the control out of those arms in `globals.css`.
          data-border-on-open="true"
          // No `aria-expanded:border-brand` here: `select-trigger` is in the field-focus block in
          // `globals.css`, which already paints it for every field-shaped control. A second copy at
          // one call site is how fields end up with the treatment while others lack it.
          className={`border-border/60 bg-surface/50 hover:bg-surface hover:border-border aria-expanded:bg-surface flex h-auto min-h-14 w-full flex-row items-center justify-between rounded-xl border px-4 py-2.5 shadow-xs transition-[background-color,border-color,opacity] duration-200 ${
            isSwitching ? "opacity-60" : ""
          }`}>
          <div className="flex flex-col items-start gap-0.5 text-left">
            {/* Rendered from `activeSaisonId`, NOT from `Select.Value`.
                `Select.Value` resolves its label out of the react-aria collection, so any render
                where the collection has not committed shows HeroUI's English "Select an item"
                placeholder instead — intermittently, and only for the name, which is exactly the
                reported symptom: the timespan below stayed correct because it reads the same prop
                this now does. Both halves of the trigger come from one source and cannot disagree. */}
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
                className="text-foreground-muted hover:bg-muted hover:text-brand fluid-sm rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
                Saison {saison.id}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </div>
  );
}
