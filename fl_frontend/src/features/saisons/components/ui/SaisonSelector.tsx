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
  // responding after a few navigations".
  //
  // A react-aria overlay light-dismisses on an outside interaction, and a client-side navigation is
  // not one — Next parks the previous page in a hidden Activity tree with its state intact. Left
  // uncontrolled, the popover can therefore stay logically OPEN across a navigation while nothing is
  // on screen: the next press *closes* it invisibly, the press after reopens it, and the trigger
  // reads as dead while faithfully toggling. It presents as intermittent and always after
  // navigating. `useNavigationClosedOverlay` exists for this hazard and covers three sites.
  //
  // Forcing it closed on every pathname change means every press starts from a known state.
  const { isOpen, setIsOpen } = useNavigationClosedOverlay();

  // Validated against the list, not taken raw from the URL. `?saison_id=` is user-editable, and an
  // id absent from `saisons` would otherwise leave the two halves of this component disagreeing: the
  // `Select` would hold a `value` matching no item in its collection and show nothing selected, while
  // `activeSaisonData` fell back to the current season for the date range beneath it.
  //
  // `resolveSaisonId` applies the same check on the server and strips an unknown id from the URL
  // (ADR-0069), which is what stops the PAGE below from disagreeing with this control. That does not
  // make this line redundant: on the admin lists the check runs inside a Suspense boundary, so the
  // shell holding this selector is already on screen while the redirect is in flight, and this is
  // what the control shows for that window.
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
  // reported "clicking it does literally nothing"). Showing the placeholder instead means the
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
          // Brand border ONLY while open (decided 2026-08-07): react-aria hands focus back to this
          // trigger when the popover dismisses — after the exit animation — so the field-focus
          // rule's focus arms kept the brand border on an outside click. The marker opts this one
          // control out of those arms in `globals.css`; the open state still paints brand there.
          data-border-on-open="true"
          // No `aria-expanded:border-brand` here: `select-trigger` is in the field-focus block in
          // `globals.css`, which paints the brand border on the open state for every field-shaped
          // control in the app. A second copy of that gesture spelled at this one call site is how
          // the app previously ended up with fields that had the treatment and fields that did not.
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

        {/* Crisp popover matching the trigger's border radius */}
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
