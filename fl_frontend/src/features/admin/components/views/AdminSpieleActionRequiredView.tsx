"use client";

import { useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { Tabs } from "@heroui/react";

import { SpielCardsList } from "@/features/spiele/components/collections/SpielCardsList";
import { groupBracketFaultsBySpielId } from "@/features/spiele/utils";
import { COUNT_BADGE } from "@/shared/components/ui/badges";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { TAB_INDICATOR, TAB_ITEM, TAB_TRACK } from "@/shared/components/ui/formFieldStyles";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { CARDS_CASCADE, PAGE_RISE } from "@/shared/components/ui/motion";

import { ACTION_REQUIRED_LABELS, buildActionRequiredSections } from "../../utils";

import type { FLBracketFault, FLSpiel } from "@/features/spiele/schemas";
import type { Key } from "@heroui/react";
import type { FLActionUrgency } from "../../utils";

/**
 * Which section is on screen.
 *
 * **It lives in the URL and nowhere else, and that is a correctness requirement rather than a
 * convenience.** The App Router keeps an admin tree alive between navigations, so a selection held in
 * `useState` — or inside an uncontrolled `Tabs` — survives a round trip to the editor and comes back
 * describing the page as it was, which is the failure class `docs/frontend/spec.md` §1.10 records
 * against the editor's own draft. State derived from a search param cannot go stale that way, because
 * the URL is what changed; it is also what Next recommends for exactly this hazard, and it makes the
 * page linkable.
 * See: https://nextjs.org/docs/app/guides/preserving-ui-state
 */
const SECTION_PARAM = "section";

/**
 * The count badge, graded by what the number means.
 *
 * **Green is reserved for zero** (decided 2026-08-07): a category with nothing in it is the one state
 * that needs no attention, and it is the only state the success accent may describe. Everything else
 * takes its own urgency's accent, so the colour says how much the number costs rather than merely that
 * it is not zero — red where a later fixture cannot resolve, amber where standings are waiting, blue
 * where it is administrative tidying that blocks nothing.
 *
 * Every pair is the app's colour rule: the plain accent at `/15` is a fill, its `-strong` companion is
 * text on that fill — the pairing `SpielStatusChip` and `Callout` were both measured at.
 *
 * `none` is `is_canceled`, and it takes the same blue as `details` (decided 2026-08-07): a cancelled
 * fixture asks nothing of anybody, which is exactly what the informational grade means, and a neutral
 * grey badge among seven coloured ones read as a control that had been switched off.
 */
const URGENCY_BADGE: Record<FLActionUrgency, string> = {
  blocking: "bg-danger/15 text-danger-strong",
  results: "bg-warning/15 text-warning-strong",
  details: "bg-info/15 text-info-strong",
  none: "bg-info/15 text-info-strong",
};

const CLEARED_BADGE = "bg-success/15 text-success-strong";

/**
 * On the selected tab the count lies on top of `Tabs.Indicator`'s brand fill, so a feedback tint would
 * be a second colour over a third. It borrows the fill's own foreground at low opacity, which reads on
 * the brand in both themes because that pairing is fixed while `--fg-base` flips.
 */
const SELECTED_BADGE = "bg-brand-solid-foreground/20 text-brand-solid-foreground";

export function AdminSpieleActionRequiredView({
  overviewSpiele,
  bracketFaults,
  today,
}: {
  overviewSpiele: FLSpiel[];
  bracketFaults: FLBracketFault[];
  today: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Memoised by hand because the React Compiler is deliberately off (see `next.config.ts`): without
  // it, every section switch re-partitions the whole match list to produce the identical result.
  const sections = useMemo(
    () => buildActionRequiredSections({ spiele: overviewSpiele, today, bracketFaults }),
    [overviewSpiele, today, bracketFaults],
  );

  // Derived here rather than in `buildActionRequiredSections`, which sorts matches and has no
  // business deriving German. Keyed by `spiel_id` so each card states its OWN reasons: one shared
  // box leaves the reader matching match numbers to cards by eye.
  const faultsBySpielId = useMemo(() => groupBracketFaultsBySpielId(bracketFaults), [bracketFaults]);

  /**
   * All eight tabs, always, whatever the counts are (decided 2026-08-06).
   *
   * A strip that gains and loses tabs as fixtures are completed is a control that moves under the hand
   * using it, and the badge already says which categories are clear.
   */
  const activeSection =
    sections.find((section) => section.category === searchParams.get(SECTION_PARAM)) ??
    // No section named, or a stale one: open the most urgent that has anything in it. Sections arrive
    // in urgency order, so "the first non-empty" is exactly that, and an all-clear season falls
    // through to the first tab rather than to none.
    sections.find((section) => section.spiele.length > 0) ??
    sections[0];

  /**
   * Moves the selection without leaving the page.
   *
   * `window.history.replaceState` rather than `router.replace`, and the reason is what this page
   * costs: its query is deliberately uncached, so a router navigation would re-read the
   * whole archive from FastAPI to change which of the already-loaded sections is on screen. The native
   * History API is Next's documented escape for exactly this — it "integrates into the Next.js
   * Router", so `useSearchParams` re-renders with the new value and browser history stays coherent.
   * See: https://nextjs.org/docs/app/getting-started/linking-and-navigating
   *
   * `replaceState` and not `pushState`: Back on a triage list should leave the list, not walk an admin
   * back through the sections they looked at. What has to survive is where they are now, and the
   * current entry carries that either way.
   */
  const selectSection = (category: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set(SECTION_PARAM, category);

    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  };

  // Only when the whole response is empty, which is a season nobody has created fixtures for yet.
  // Without this the page renders a bordered, empty 44px tab bar and eight zero-panels.
  if (activeSection === undefined) {
    return (
      <div className="flex w-full flex-1 items-start justify-center p-6">
        <EmptyState
          tone="positive"
          title="Alles erledigt!"
          hint="Kein Spiel braucht gerade eine Eingabe."
        />
      </div>
    );
  }

  return (
    // Every class below that can be `SpielplanView`'s is: one control, one job. What is
    // NOT shared is the selection, which here comes from the URL (`SECTION_PARAM`).
    // `selectedKey` is HeroUI v3's Tabs API, never the field components' `value`.
    <Tabs
      selectedKey={activeSection.category}
      onSelectionChange={(key: Key) => selectSection(String(key))}
      className={`${PAGE_RISE} relative flex w-full flex-1 flex-col items-center`}>
      {/* The sticky bar is an ordinary element, and `Tabs.ListContainer` sits INSIDE it holding only
          the track. Two reasons, both structural. The container is a collection-slot injector rather
          than a wrapper — a sibling passed to it is swallowed, so the hint could not live there — and
          its chevron buttons are positioned `start-1` / `end-1` against it, which is the track's edge
          only while the container IS the track. Everything about the bar itself is `SpielplanView`'s
          string, unchanged. */}
      <div className="bg-background sticky top-0 z-20 flex w-full flex-col items-center px-4 py-4 sm:px-8 lg:py-8">
        <div className="lg:max-w-toolbar flex w-full max-w-full flex-row items-center justify-center gap-x-2 lg:w-[90%]">
          {/* **No `overflow-x-auto` and no `scrollbar-hide` on the list, and that is the whole scroll
              affordance.** `Tabs.ListContainer` already ships the best-practice answer for a strip
              wider than its rail: a `ScrollShadow` scroller plus chevron buttons that a `:has()` rule
              reveals ONLY while the shadow reports `data-left-scroll` / `data-right-scroll`. It works
              by letting the list grow — HeroUI gives `.tabs__list` `w-max min-w-full` and says so at
              the rule — so a list that scrolls itself hides the overflow from the detector and the
              chevrons then never appear. Eight tabs overflow a phone, and shift-scroll is not an
              affordance anyone should be expected to know.

              `min-w-fit` undoes HeroUI's `min-w-full` on `.tabs__list`: that floor stretched the track
              to the whole rail, so eight content-width tabs left a stretch of empty track after the
              last one. `w-max` is the half that must stay — it is what lets the list outgrow the rail
              and so what the overflow detection reads.

              `bg-transparent` undoes the container's own `bg-default`: the track below carries the
              app's surface, and two backgrounds would put a second rectangle behind it. */}
          <Tabs.ListContainer className="max-w-full min-w-0 bg-transparent [&>div]:max-w-full [&>div]:min-w-0 [&>div]:[--scroll-shadow-size:24px]!">
            <Tabs.List
              aria-label="Kategorie auswählen"
              className={`${TAB_TRACK} flex w-max min-w-fit flex-row items-center gap-1 p-1.5 shadow-sm`}>
              {sections.map((section) => {
                const label = ACTION_REQUIRED_LABELS[section.category];
                const isActive = section.category === activeSection.category;
                const isCleared = section.spiele.length === 0;

                return (
                  <Tabs.Tab
                    key={section.category}
                    id={section.category}
                    /* The tab says `short`, which is what keeps the strip on one row at desktop
                     width. **`w-fit` undoes HeroUI's `w-full` on `.tabs__tab`**: left at `w-full`
                     inside a `min-w-full` list, the tabs share the rail equally and become slabs. */
                    className={`${TAB_ITEM} flex h-11 w-fit items-center gap-x-2 px-5 whitespace-nowrap md:px-6`}>
                    {label.short}
                    <span className={`${COUNT_BADGE} ${isActive ? SELECTED_BADGE : isCleared ? CLEARED_BADGE : URGENCY_BADGE[label.urgency]}`}>
                      {section.spiele.length}
                    </span>
                    <Tabs.Indicator className={TAB_INDICATOR} />
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
          </Tabs.ListContainer>

          {/* What the selected tab's one word covers, in the app's own "explain this surface"
              affordance rather than as a line of prose over the grid (decided 2026-08-07). `InfoHint`
              and not `IconTooltip`: react-aria's tooltip opens on hover and focus and deliberately
              never on tap, so on the phone this page is worked from it would be unreachable. It reads
              the ACTIVE section, so one glyph serves all eight categories and the toolbar keeps its
              height whichever is selected. */}
          <InfoHint label={`Was "${ACTION_REQUIRED_LABELS[activeSection.category].name}" umfasst`}>
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
          className="max-w-page flex w-full flex-col items-center gap-y-5 px-4 pt-0 pb-4 outline-none sm:px-8">
          {section.spiele.length === 0 ? (
            <EmptyState
              tone="positive"
              title="Keine Spiele in dieser Kategorie!"
            />
          ) : (
            // The app's one card grid, holding its one admin match card. Faults reach the
            // `bracket_fault` section alone — the one list already filtered by that diagnosis, and the
            // only category whose tab cannot state the reason itself.
            <div
              role="list"
              className={`${CARDS_CASCADE} grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3`}>
              <SpielCardsList
                spiele={[...section.spiele]}
                today={today}
                isAdmin
                faultsBySpielId={section.category === "bracket_fault" ? faultsBySpielId : undefined}
              />
            </div>
          )}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
}
