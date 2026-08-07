"use client";

import { Sliders, Xmark } from "@gravity-ui/icons";

import { Button, ListBox, Popover, Separator } from "@heroui/react";

import { useUrlFilters } from "@/shared/hooks/useUrlFilters";
import { countFacetOptions } from "@/shared/utils/facets";

import { COUNT_BADGE, LABEL_BADGE } from "./badges";
import { overlayPanel } from "./overlayPanel";

import type { Facet } from "@/shared/utils/facets";
import type { Selection } from "@heroui/react";

/**
 * The filter control: one trigger, a popover of multi-selects, and the active choices as removable chips.
 *
 * **A popover rather than a row of dropdowns or a wall of chips** (owner, 2026-08-07). Spielsuche wants
 * seven dimensions and Saisons wants two, so the control has to scale across an order of magnitude: a
 * dropdown per facet wraps badly past three and hides which values are excluded, and every option
 * rendered inline is a wall on the big surfaces. One trigger scales; the chips underneath are what keep
 * the current state visible, which is the thing a closed popover would otherwise cost.
 *
 * **Every count is computed with its own facet's selection removed** — see `countFacetOptions`. A number
 * beside an option answers "what would I get if I picked this too", which is the only question worth
 * answering there.
 *
 * **An option that would leave nothing is disabled rather than hidden**, the rule `GruppeSelect` already
 * follows: the reader should see why a value cannot be picked instead of wondering where it went. An
 * option that is currently selected stays enabled whatever its count, or deselecting it would be
 * impossible.
 *
 * **The state is the URL's and nothing here holds any** — `useUrlFilters` carries the reasoning, and the
 * short version is that filtering must not cost a server round trip on a page that already holds all its
 * rows.
 */
export function FilterBar<TItem>({
  facets,
  items,
  triggerLabel = "Filter",
}: {
  /** Must be a module-scope constant, for the reason `AdminCrudView`'s `searchKeys` must be. */
  facets: readonly Facet<TItem>[];
  /** Every row before filtering, so each option can say what it would leave. */
  items: TItem[];
  triggerLabel?: string;
}) {
  const { selection, activeCount, toggle, setFacet, clearFacet, clearAll } = useUrlFilters(facets);

  if (facets.length === 0) return null;

  // One chip per selected value, flattened across facets, in the facets' own order so the strip does not
  // reorder itself as choices are made.
  const chips = facets.flatMap((facet) =>
    (selection[facet.param] ?? []).map((value) => ({
      facet,
      value,
      label: facet.options.find((option) => option.value === value)?.label ?? value,
    })),
  );

  return (
    <div className="flex w-full flex-row flex-wrap items-center gap-2">
      <Popover>
        <Popover.Trigger
          aria-label={activeCount === 0 ? triggerLabel : `${triggerLabel}, ${String(activeCount)} aktiv`}
          className="border-border bg-surface text-foreground hover:bg-muted fluid-xs flex h-10 shrink-0 cursor-pointer flex-row items-center gap-x-2 rounded-xl border px-3 font-bold shadow-sm transition-colors">
          <Sliders
            aria-hidden="true"
            width={16}
            height={16}
          />
          {triggerLabel}
          {activeCount > 0 && <span className={`${COUNT_BADGE} bg-brand/50 text-foreground`}>{activeCount}</span>}
        </Popover.Trigger>

        <Popover.Content
          placement="bottom start"
          offset={8}>
          {/* `max-h` plus its own scroll, because Spielsuche's seven facets are taller than a phone.
              `w-72` rather than a width from the trigger: the options are the content that needs the
              room, and a trigger reading „Filter“ is narrower than any of them. */}
          <Popover.Dialog className={`${overlayPanel()} flex max-h-[70vh] w-72 flex-col gap-y-1 overflow-y-auto p-2 outline-none`}>
            {facets.map((facet, index) => {
              const counts = countFacetOptions(items, facets, selection, facet);
              const picked = selection[facet.param] ?? [];

              return (
                <div
                  key={facet.param}
                  className="flex w-full flex-col gap-y-1">
                  {index > 0 && <Separator className="bg-border/60 my-1" />}

                  <div className="flex flex-row items-center justify-between gap-x-2 px-2 pt-1">
                    <span className="fluid-xxs text-foreground-muted font-bold tracking-widest uppercase">{facet.label}</span>
                    {picked.length > 0 && (
                      <Button
                        variant="ghost"
                        aria-label={`${facet.label} zurücksetzen`}
                        onPress={() => clearFacet(facet.param)}
                        className="fluid-xxs text-foreground-muted hover:text-foreground cursor-pointer font-bold transition-colors">
                        Zurücksetzen
                      </Button>
                    )}
                  </div>

                  <ListBox
                    aria-label={facet.label}
                    selectionMode="multiple"
                    selectedKeys={picked}
                    // `Selection` is `"all" | Set<Key>`; `"all"` is only reachable by passing
                    // `selectedKeys="all"`, which this never does, so it maps to an empty selection
                    // rather than to a cast.
                    onSelectionChange={(keys: Selection) => {
                      setFacet(facet.param, keys === "all" ? [] : [...keys].map(String));
                    }}>
                    {facet.options.map((option) => {
                      const count = counts[option.value] ?? 0;
                      const isPicked = picked.includes(option.value);

                      return (
                        <ListBox.Item
                          key={option.value}
                          id={option.value}
                          textValue={option.label}
                          // A selected option stays enabled whatever its count — disabling it would make
                          // it impossible to deselect, which is the one state this rule must not create.
                          isDisabled={count === 0 && !isPicked}
                          className="text-foreground-muted hover:bg-muted hover:text-brand data-selected:text-foreground fluid-sm flex cursor-pointer flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2 font-bold transition-colors data-disabled:opacity-40">
                          <span className="min-w-0 truncate">{option.label}</span>
                          <span className={`${COUNT_BADGE} bg-muted text-foreground-muted shrink-0`}>{count}</span>
                        </ListBox.Item>
                      );
                    })}
                  </ListBox>
                </div>
              );
            })}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>

      {/* The chips are what make a closed popover honest: they say what is narrowing the list, and each
          one removes exactly itself. */}
      {chips.map(({ facet, value, label }) => (
        <Button
          key={`${facet.param}:${value}`}
          variant="ghost"
          aria-label={`Filter ${facet.label}: ${label} entfernen`}
          // `toggle`, not a filtered `setFacet`: it reads the live selection itself, so removing two chips
          // in quick succession cannot have the second one rebuild from a snapshot taken before the first.
          onPress={() => toggle(facet.param, value)}
          className={`${LABEL_BADGE} bg-brand/15 text-foreground hover:bg-brand/25 flex cursor-pointer flex-row items-center gap-x-1.5 transition-colors`}>
          <span className="text-foreground-muted font-medium">{facet.label}:</span>
          {label}
          <Xmark
            aria-hidden="true"
            className="size-3 shrink-0"
          />
        </Button>
      ))}

      {activeCount > 1 && (
        <Button
          variant="ghost"
          onPress={clearAll}
          className="fluid-xxs text-foreground-muted hover:text-foreground cursor-pointer font-bold underline transition-colors">
          Alle zurücksetzen
        </Button>
      )}
    </div>
  );
}
