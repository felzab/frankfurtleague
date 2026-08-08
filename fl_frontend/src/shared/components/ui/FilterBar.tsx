"use client";

import { Sliders, Xmark } from "@gravity-ui/icons";

import { Button, ListBox, Popover } from "@heroui/react";

import { useUrlFilters } from "@/shared/hooks/useUrlFilters";
import { countFacetOptions } from "@/shared/utils/facets";

import { COUNT_BADGE } from "./badges";
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
          {/* A GRID that grows sideways, not a single tall column (owner, 2026-08-08). Seven facets stacked
              made the popover a scroll on every screen; in three columns the same seven fit a desktop
              outright, and the scroll that remains is a fallback rather than the normal way to reach the
              last facet. `min(92vw, …)` because a fixed width wide enough for three columns overflows a
              phone, where the grid collapses to one column anyway.

              `data-scrollbar="thin"` is what makes the remaining scroll look like the rest of the app:
              HeroUI drives its scrollbar off that attribute rather than off a class, so a container with
              `overflow-y-auto` and nothing else gets the raw OS scrollbar. */}
          <Popover.Dialog
            data-scrollbar="thin"
            className={`${overlayPanel()} grid max-h-[70vh] w-[min(92vw,22rem)] grid-cols-1 gap-3 overflow-y-auto p-3 outline-none sm:w-[min(92vw,34rem)] sm:grid-cols-2 lg:w-[min(92vw,48rem)] lg:grid-cols-3`}>
            {facets.map((facet) => {
              const counts = countFacetOptions(items, facets, selection, facet);
              const picked = selection[facet.param] ?? [];

              return (
                <div
                  key={facet.param}
                  // A bordered cell rather than a rule between stacked rows: in a grid a horizontal
                  // separator would divide two columns' worth of unrelated facets.
                  className="border-border/70 flex w-full min-w-0 flex-col gap-y-1 rounded-xl border p-1.5">
                  <div className="flex flex-row items-center justify-between gap-x-2 px-1.5 pt-0.5">
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
          one removes exactly itself.

          Redesigned (owner, 2026-08-08). The previous chip ran the facet name, a colon and the value
          together at `fluid-xxs` inside a tinted pill, with the × crowding the value — three pieces of text
          at one size with no boundary between them, which is why it did not read. Now the facet name is its
          own segment on a lighter ground, the VALUE carries the weight, and the × sits behind a hairline
          divider so it reads as a separate target rather than as punctuation. Taller, too: this is a control
          people click, and it was below a comfortable target. */}
      {chips.map(({ facet, value, label }) => (
        <span
          key={`${facet.param}:${value}`}
          className="border-brand/25 bg-brand/10 flex h-7 shrink-0 flex-row items-stretch overflow-hidden rounded-lg border">
          <span className="fluid-xxs text-foreground-muted bg-brand/10 flex items-center px-2 font-bold tracking-wide uppercase">
            {facet.label}
          </span>
          <span className="fluid-xs text-foreground flex min-w-0 items-center truncate px-2 font-bold">{label}</span>
          <Button
            variant="ghost"
            aria-label={`Filter ${facet.label}: ${label} entfernen`}
            // `toggle`, not a filtered `setFacet`: it reads the live selection itself, so removing two chips
            // in quick succession cannot have the second one rebuild from a snapshot taken before the first.
            onPress={() => toggle(facet.param, value)}
            className="border-brand/25 text-foreground-muted hover:bg-danger/15 hover:text-danger-strong flex cursor-pointer items-center border-l px-1.5 transition-colors">
            <Xmark
              aria-hidden="true"
              className="size-3.5 shrink-0"
            />
          </Button>
        </span>
      ))}

      {/* A real button rather than an underlined word at the end of the strip, which read as the last chip's
          caption. Bordered, icon-led, and set apart by `ml-1` so the strip has an end. */}
      {activeCount > 1 && (
        <Button
          variant="ghost"
          onPress={clearAll}
          className="border-border text-foreground-muted hover:border-danger/40 hover:text-danger-strong fluid-xxs ml-1 flex h-7 shrink-0 cursor-pointer flex-row items-center gap-x-1.5 rounded-lg border px-2.5 font-bold transition-colors">
          <Xmark
            aria-hidden="true"
            className="size-3.5 shrink-0"
          />
          Alle Filter zurücksetzen
        </Button>
      )}
    </div>
  );
}
