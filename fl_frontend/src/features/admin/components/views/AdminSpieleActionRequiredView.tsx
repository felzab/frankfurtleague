"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { Tabs } from "@heroui/react/tabs";

import { SpielCardsList } from "@/features/spiele/components/collections/SpielCardsList";
import { SpielCardGrid } from "@/features/spiele/components/ui/SpielCardGrid";
import { groupBracketFaultsBySpielId } from "@/features/spiele/utils";
import { COUNT_BADGE_CLASSES, trackCountBadge } from "@/shared/components/ui/badges";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { TAB_INDICATOR_CLASSES, TAB_ITEM_CLASSES, TAB_TRACK_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { CARDS_CASCADE_CLASSES, PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";

import { ACTION_REQUIRED_LABELS, buildActionRequiredSections } from "../../utils";

import type { FLBracketFault, FLSpiel } from "@/features/spiele/schemas";
import type { FeedbackTone } from "@/shared/components/ui/badges";
import type { Key } from "@heroui/react/rac";
import type { FLActionUrgency } from "../../utils";

/**
 * In the URL and not `useState`: the App Router keeps an admin tree alive between navigations, so a
 * held selection survives a round trip to the editor and comes back stale.
 * https://nextjs.org/docs/app/guides/preserving-ui-state
 */
const SECTION_PARAM = "section";

/**
 * Success is reserved for a cleared category, and `none` — `abgesagt` — shares `details`' blue on
 * purpose: a fixture that did not happen asks nothing.
 */
const URGENCY_TONE: Record<FLActionUrgency, FeedbackTone> = {
  blocking: "danger",
  results: "warning",
  details: "info",
  none: "info",
};

/**
 * The selected count lies on `Tabs.Indicator`'s brand fill rather than on the track, so no recipe
 * fits it: it borrows that fill's foreground instead of adding a third colour, a pairing that
 * holds in both themes while `--fg-base` flips.
 */
const SELECTED_BADGE_CLASSES = `${COUNT_BADGE_CLASSES} bg-brand-solid-foreground/20 text-brand-solid-foreground`;

export function AdminSpieleActionRequiredView({
  overviewSpiele,
  bracketFaults,
  today,
  isFinishedSaison,
}: {
  overviewSpiele: FLSpiel[];
  bracketFaults: FLBracketFault[];
  today: string;
  isFinishedSaison: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Memoised by hand: the React Compiler is deliberately off (`next.config.ts`), so without this
  // every section switch re-partitions the whole match list for the identical result.
  const sections = useMemo(
    () => buildActionRequiredSections({ spiele: overviewSpiele, today, bracketFaults }),
    [overviewSpiele, today, bracketFaults],
  );

  // Keyed by `spiel_id` so each card states its own reasons; one shared box leaves the reader
  // matching match numbers to cards by eye.
  const faultsBySpielId = useMemo(() => groupBracketFaultsBySpielId(bracketFaults), [bracketFaults]);

  const activeSection =
    sections.find((section) => section.category === searchParams.get(SECTION_PARAM)) ??
    // No section named, or a stale one. Sections arrive in urgency order, so the first non-empty is
    // the most urgent, and an all-clear season falls through to the first tab rather than to none.
    sections.find((section) => section.spiele.length > 0) ??
    sections[0];

  /**
   * `replaceState` and not `router.replace`: the page's query is deliberately uncached, so a router
   * navigation would re-read the season's queue just to switch sections. Not `pushState` — Back
   * should leave the list rather than walk it.
   */
  const selectSection = (category: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(SECTION_PARAM, category);

    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  };

  // The type checker's floor, not a state the data reaches: the section list is built from
  // `ACTION_REQUIRED_LABELS`, so it is never empty and only `noUncheckedIndexedAccess` reads
  // `sections[0]` as absent.
  if (activeSection === undefined) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        <EmptyState
          title="Diese Übersicht lässt sich gerade nicht anzeigen."
          hint="Lade die Seite neu."
        />
      </div>
    );
  }

  return (
    // `selectedKey` is HeroUI's Tabs API, never the field components' `value`.
    <Tabs
      selectedKey={activeSection.category}
      onSelectionChange={(key: Key) => selectSection(String(key))}
      className={`${PAGE_RISE_CLASSES} relative flex w-full flex-1 flex-col items-center`}>
      {/* `Tabs.ListContainer` holds only the track: it injects a collection slot rather than
          wrapping, so a sibling passed to it is swallowed, and its chevrons are positioned against
          it — the track's edge only while it is the track. */}
      <div className="sticky top-0 z-20 flex w-full flex-col items-center bg-background px-4 py-4 sm:px-8 lg:py-8">
        <div className="flex w-full max-w-toolbar flex-row items-center justify-center gap-x-2">
          {/* No `overflow-x-auto` on the list: the container's chevrons appear only while its
              `ScrollShadow` detects overflow, and a list that scrolls itself hides that. `w-max` is
              the half of HeroUI's floor that must stay — it is what the detection reads. */}
          <Tabs.ListContainer className="max-w-full min-w-0 bg-transparent [&>div]:max-w-full [&>div]:min-w-0 [&>div]:[--scroll-shadow-size:24px]!">
            <Tabs.List
              aria-label="Kategorie auswählen"
              className={`${TAB_TRACK_CLASSES} flex w-max min-w-fit flex-row items-center gap-1 p-1.5 shadow-sm`}>
              {sections.map((section) => {
                const label = ACTION_REQUIRED_LABELS[section.category];
                const isActive = section.category === activeSection.category;
                const isCleared = section.spiele.length === 0;
                const countClass = isActive ? SELECTED_BADGE_CLASSES : trackCountBadge(isCleared ? "success" : URGENCY_TONE[label.urgency]);

                return (
                  <Tabs.Tab
                    key={section.category}
                    id={section.category}
                    /* `w-fit` undoes HeroUI's `w-full` on `.tabs__tab`: left at `w-full` the tabs
                     share the rail equally and become slabs. */
                    className={`${TAB_ITEM_CLASSES} flex h-11 w-fit items-center gap-x-2 px-5 whitespace-nowrap md:px-6`}>
                    {label.short}
                    <span className={countClass}>{section.spiele.length}</span>
                    <Tabs.Indicator className={TAB_INDICATOR_CLASSES} />
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
          </Tabs.ListContainer>

          {/* `InfoHint` and not `IconTooltip`: react-aria's tooltip opens on hover and focus and never
              on tap, so on the phone this page is worked from it would be unreachable. It reads the
              active section, so one glyph serves every category. */}
          <InfoHint label={`Was „${ACTION_REQUIRED_LABELS[activeSection.category].name}“ umfasst`}>
            <p>
              <strong>{ACTION_REQUIRED_LABELS[activeSection.category].name}</strong>
            </p>
            <p>{ACTION_REQUIRED_LABELS[activeSection.category].desc}.</p>
          </InfoHint>
        </div>
      </div>

      {sections.map((section) => (
        <Tabs.Panel
          key={section.category}
          id={section.category}
          className="flex w-full flex-col items-center px-4 pt-0 pb-4 outline-none sm:px-8">
          <div className="flex w-full max-w-page flex-col items-center gap-y-6">
            {section.spiele.length === 0 ? (
              <EmptyState
                tone="positive"
                title="In dieser Kategorie braucht kein Spiel etwas."
              />
            ) : (
              // Faults reach the `bracket_fault` section alone: the one list already filtered by that
              // diagnosis, and the only category whose tab cannot state the reason itself.
              <SpielCardGrid
                role="list"
                className={CARDS_CASCADE_CLASSES}>
                <SpielCardsList
                  spiele={[...section.spiele]}
                  today={today}
                  isFinishedSaison={isFinishedSaison}
                  isAdmin
                  faultsBySpielId={section.category === "bracket_fault" ? faultsBySpielId : undefined}
                />
              </SpielCardGrid>
            )}
          </div>
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
