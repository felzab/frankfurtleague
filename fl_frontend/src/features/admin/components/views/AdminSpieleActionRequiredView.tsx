"use client";

import { useMemo } from "react";

import { ChevronsDownWide } from "@gravity-ui/icons";

import { Accordion } from "@heroui/react";

import { SpielCardsList } from "@/features/spiele/components/collections/SpielCardsList";
import { formatBracketFault } from "@/features/spiele/utils";
import { card } from "@/shared/components/ui/card";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { CARDS_CASCADE } from "@/shared/components/ui/motion";
import { typedObjectEntries } from "@/shared/utils/type";

import { ACTION_REQUIRED_LABELS, categorizeActionRequired } from "../../utils";

import type { FLBracketFault, FLSpiel } from "@/features/spiele/schemas";

export function AdminSpieleActionRequiredView({
  overviewSpiele,
  bracketFaults,
  today,
}: {
  overviewSpiele: FLSpiel[];
  bracketFaults: FLBracketFault[];
  today: string;
}) {
  // Memoised by hand because the React Compiler is deliberately off (see `next.config.ts`). Without
  // it, every `Accordion` expand and collapse re-partitions the whole match list — eight fresh arrays
  // and an O(n) pass with six predicates per match — to produce the identical result.
  const spieleCategories = useMemo(
    () => categorizeActionRequired(overviewSpiele, today, bracketFaults),
    [overviewSpiele, today, bracketFaults],
  );

  // Derived here rather than in `categorizeActionRequired`, which sorts matches and has no business
  // deriving German. One fixture can carry several faults — two broken sides, or a cycle reported
  // beside a group reference — and each gets its own sentence, because each is corrected separately.
  const faultSentences = useMemo(() => bracketFaults.map(formatBracketFault), [bracketFaults]);

  return (
    <div className="relative flex w-full flex-1 flex-col items-center px-4 pt-6 pb-12 sm:px-8">
      {/* The route's design has no visible page title, so the `h1` that anchors the heading list is
          visually hidden. Its text matches the sidemenu entry that leads here. */}
      <h1 className="sr-only">Übersicht: Spiele mit Handlungsbedarf</h1>

      <Accordion className="text-foreground max-w-page flex w-full flex-col gap-y-4">
        {/* typedObjectEntries, not Object.entries: the latter widens the key to string, which would
            make the ACTION_REQUIRED_LABELS lookup below an unchecked index. */}
        {typedObjectEntries(spieleCategories).map(([category, spiele]) => {
          const hasItems = spiele.length > 0;
          const label = ACTION_REQUIRED_LABELS[category];

          return (
            <Accordion.Item
              key={category}
              /* `card()` and nothing else — in particular no `overflow-hidden`, which would clip the
                 team popovers the cards inside this panel open. */
              className={card()}>
              {/* `level={2}` sits these eight under the page `h1`. `Accordion.Heading` already emits a
                  real heading wrapping the trigger (react-aria-components defaults it to `h3`), so
                  the category name did not need to become one — the level was the only thing wrong. */}
              <Accordion.Heading level={2}>
                <Accordion.Trigger className="hover:bg-muted/40 flex w-full flex-row items-center justify-between rounded-2xl px-6 py-5 text-left transition-colors">
                  <div className="flex flex-col gap-y-1">
                    <div className="flex items-center gap-x-3">
                      <span className="fluid-base text-foreground font-extrabold tracking-tight">{label.name}</span>
                      {/* The `-solid` fills hold one deep value in both themes, so white stays legible
                          on them. The plain `danger`/`success` accents are tuned as tints and
                          measured 3.30:1 light / 2.28:1 dark behind this 12px bold count. */}
                      <span
                        className={`fluid-xxs inline-flex items-center justify-center rounded-lg px-2.5 py-0.5 font-extrabold shadow-sm ${
                          hasItems ? "bg-danger-solid text-danger-solid-foreground" : "bg-success-solid text-success-solid-foreground"
                        }`}>
                        {spiele.length}
                      </span>
                    </div>
                    <span className="fluid-xxs text-foreground-muted font-medium">{label.desc}</span>
                  </div>
                  <Accordion.Indicator className="text-foreground-muted transition-transform duration-200">
                    <ChevronsDownWide
                      width={18}
                      height={18}
                    />
                  </Accordion.Indicator>
                </Accordion.Trigger>
              </Accordion.Heading>

              <Accordion.Panel>
                <Accordion.Body className="border-border flex w-full flex-col items-center gap-y-5 border-t px-2 py-6 lg:px-6">
                  {/* Above the grid rather than on each card. A card is a `role="listitem"` of the
                      `role="list"` below, and a wrapper holding a note and a card would sit between
                      the two and sever that relationship. Every sentence opens with its own match
                      number, which is what each card leads with. */}
                  {category === "bracket_fault" && hasItems && (
                    <ul className="bg-danger/5 border-danger/20 fluid-xxs text-danger-strong flex w-full flex-col gap-y-1.5 rounded-xl border px-4 py-3 font-semibold">
                      {faultSentences.map((sentence) => (
                        <li key={sentence}>{sentence}</li>
                      ))}
                    </ul>
                  )}

                  {hasItems ? (
                    // Cascades like every other `SpielCard` grid. It reads especially well here
                    // because the trigger is an accordion expanding: the cards arrive into the space
                    // the panel is opening rather than being there the instant it does.
                    <div
                      role="list"
                      className={`${CARDS_CASCADE} grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3`}>
                      <SpielCardsList
                        spiele={spiele}
                        today={today}
                        isAdmin
                      />
                    </div>
                  ) : (
                    <EmptyState
                      tone="positive"
                      title="Keine Spiele in dieser Kategorie!"
                    />
                  )}
                </Accordion.Body>
              </Accordion.Panel>
            </Accordion.Item>
          );
        })}
      </Accordion>
    </div>
  );
}
