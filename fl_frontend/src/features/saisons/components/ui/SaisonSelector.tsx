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

  // The popover's open state is OURS, not react-aria's, and that is the fix for "the trigger stops
  // responding after a few navigations" (NEW-R6, second round).
  //
  // Left uncontrolled, this was the third site matching the hazard `useNavigationClosedOverlay` was
  // written for and the only one not wired to it. A react-aria overlay light-dismisses on an outside
  // interaction, and a client-side navigation is not one — Next then parks the previous page in a
  // hidden Activity tree with its state intact. So the popover could stay logically OPEN across a
  // navigation while nothing was on screen. The next press then *closed* it (invisible, because it
  // was never painted), the press after reopened it, and so on: the trigger looked completely dead
  // while faithfully toggling, which is why it presented as intermittent and always after navigating.
  //
  // Forcing it closed on every pathname change means every press starts from a known state.
  const { isOpen, setIsOpen } = useNavigationClosedOverlay();

  // Validated against the list, not taken raw from the URL. `?saison_id=` is user-editable, and an
  // id that is not in `saisons` used to leave the two halves of this component disagreeing: the
  // `Select` had a `value` matching no item in its collection (so it showed nothing selected) while
  // `activeSaisonData` silently fell back to the current season for the date range beneath it.
  const requestedSaisonId = searchParams.get("saison_id");
  const activeSaisonData = saisons.find((saison) => saison.id === requestedSaisonId) ?? currentSaison;
  const activeSaisonId = activeSaisonData.id;

  const timespan = `${formatSpielDatum(activeSaisonData.start_date)} - ${formatSpielDatum(activeSaisonData.end_date)}`;

  const handleSelectionChange = (key: Key | null) => {
    if (!key) return;

    const selectedId = key.toString();
    const params = new URLSearchParams(searchParams.toString());

    // The current season is the backend's default (BE-1), so it is represented by the ABSENCE of the
    // parameter rather than by its value. Keeps the common URL clean and shareable.
    if (selectedId !== currentSaison.id) {
      params.set("saison_id", selectedId);
    } else {
      params.delete("saison_id");
    }

    // Closed explicitly, not left to the navigation. `useNavigationClosedOverlay` watches the
    // *pathname*, and switching season changes only the query string — so this is the one exit route
    // the hook cannot cover, and without it the popover would stay open across the switch.
    setIsOpen(false);

    // In a transition, so React keeps the current page interactive while the new season's data is
    // fetched instead of replacing streamed-in regions with their fallbacks. Without it, switching
    // season could flash the sidemenu's own skeletons — including this control's.
    startSwitching(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  // Until React has attached to this subtree the trigger below is inert: the selector streams in as
  // finished markup long before hydration reaches it, and a press in that window opens nothing (the
  // owner's "clicking it does literally nothing" — NEW-R6). Showing the placeholder instead means the
  // control only appears once it works. The server renders this branch too, so there is no mismatch.
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
        {/* Sleek, single-layer trigger with interactive border states */}
        <Select.Trigger
          // `aria-busy` while the new season's data is in flight, and the dimming tells a sighted
          // user the press landed — a season switch is a server round-trip, so without it the only
          // feedback is the page changing some time later.
          aria-busy={isSwitching}
          className={`border-border/60 bg-surface/50 hover:bg-surface hover:border-border aria-expanded:border-brand aria-expanded:bg-surface flex h-auto min-h-14 w-full flex-row items-center justify-between rounded-xl border px-4 py-2.5 shadow-xs transition-[background-color,border-color,opacity] duration-200 ${
            isSwitching ? "opacity-60" : ""
          }`}>
          <div className="flex flex-col items-start gap-0.5 text-left">
            {/* Rendered from `activeSaisonId`, NOT from `Select.Value`.
                `Select.Value` resolves its label out of the react-aria collection, so any render
                where the collection has not committed shows HeroUI's English "Select an item"
                placeholder instead — intermittently, and only for the name, which is exactly the
                reported symptom: the timespan below stayed correct because it reads the same prop
                this now does. Both halves of the trigger come from one source and cannot disagree. */}
            <span className="text-fluid-lg text-foreground font-black tracking-tight">{`Saison ${activeSaisonId}`}</span>
            <Description className="text-fluid-xxs text-foreground-muted font-bold tracking-wider uppercase">{timespan}</Description>
          </div>

          <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
        </Select.Trigger>

        {/* Crisp popover matching the trigger's border radius */}
        <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
          <ListBox aria-label="Verfügbare Saisons">
            {saisons.map((saison) => (
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
