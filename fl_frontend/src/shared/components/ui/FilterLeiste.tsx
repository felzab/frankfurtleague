"use client";

import { useEffect, useRef, useState } from "react";

import { ChevronDown, Sliders, Xmark } from "@gravity-ui/icons";

import { Button, ListBox, Popover, ScrollShadow } from "@heroui/react";

import { useUrlFilters } from "@/shared/hooks/useUrlFilters";
import { countFacetOptions, splitPromotedFacets } from "@/shared/utils/facets";

import { COUNT_BADGE } from "./badges";
import { fitOverflow, isNarrowRow } from "./filterLeisteFit";
import { overlayPanel } from "./overlayPanel";

import type { Facet, FacetSelection } from "@/shared/utils/facets";
import type { Selection } from "@heroui/react";

/** `gap-2` between two triggers, in pixels, because the fit is arithmetic and CSS cannot report it. */
const TRIGGER_GAP = 8;

/**
 * What every control in this row is, and the reason the row reads as one set of controls: the app's
 * `h-10` box — a border, the surface fill, `shadow-sm` and `rounded-xl`, the recipe the back buttons,
 * the Spieltage control and `AdminCrudFallback`'s own skeleton for THIS row all carry.
 *
 * **No state may leave it.** A dimension that is filtering says so in what the box CONTAINS; a box that
 * changed its fill, its border or its radius would stop being one of the controls beside it, which is
 * the one thing a row of peers cannot afford.
 */
const CONTROL_BOX = "border-border bg-surface fluid-xs flex h-10 shrink-0 flex-row rounded-xl border font-bold shadow-sm";

/** `items-stretch` so the clear control is full height; `overflow-hidden` so its fill takes the corner. */
const TRIGGER_SHELL = `${CONTROL_BOX} items-stretch overflow-hidden`;

const OVERFLOW_SHELL = `${CONTROL_BOX} text-foreground cursor-pointer items-center gap-x-2 px-3 whitespace-nowrap`;

/**
 * The clear control's box, worn by the live button and by the hidden row's stand-in for it.
 *
 * **Sized by `w-7` rather than by its own padding**, because only one of the two wearing this is a
 * HeroUI `Button`, and `.button svg` pulls an icon 2px in on each side — content sizing would leave the
 * measured stand-in 4px wider than the control it stands in for.
 */
const CLEAR_FACE = "flex h-full w-7 shrink-0 items-center justify-center rounded-none p-0";

/**
 * The ceiling on a picked value, in `em` so it holds the same number of characters at every width.
 *
 * **The narrow number is what the phone row leaves, not a taste.** A 375px viewport gives this row
 * 343px. The public Spielsuche spends 273 of that on `Status`, `Phase`, the active trigger's own
 * chrome, three gaps and the overflow icon, so 70px is the whole remainder — and 5em is 60.6px at that
 * width, which lands the row at 334 with something to spare for a font wider than it was reckoned.
 *
 * **The wide number bounds the pathological case and clips no real name**: 16em is 223px at 1280px,
 * where four capped triggers plus their gaps come to 1100 against a 1200px row, so the public surface
 * cannot be made to scroll at all. `min-w-0` is what makes either cap bite — a flex item's automatic
 * minimum is its content, and it would otherwise outrank the maximum and print the value in full.
 */
const VALUE_CAP_NARROW = "min-w-0 max-w-[5em]";
const VALUE_CAP_WIDE = "min-w-0 max-w-[16em]";

/** One dimension's options, shared by an inline trigger's own menu and by the overflow's cells. */
function FacetOptions<TItem>({
  facet,
  items,
  facets,
  selection,
  onSelect,
}: {
  facet: Facet<TItem>;
  items: TItem[];
  facets: readonly Facet<TItem>[];
  selection: FacetSelection;
  onSelect: (values: string[]) => void;
}) {
  const counts = countFacetOptions(items, facets, selection, facet);
  const picked = selection[facet.param] ?? [];

  return (
    <ListBox
      aria-label={facet.label}
      selectionMode="multiple"
      className="scrollbar-line max-h-72 overflow-x-hidden overflow-y-auto"
      selectedKeys={picked}
      // `Selection` is `"all" | Set<Key>`; `"all"` is only reachable by passing `selectedKeys="all"`,
      // which this never does, so it maps to an empty selection rather than to a cast.
      onSelectionChange={(keys: Selection) => {
        onSelect(keys === "all" ? [] : [...keys].map(String));
      }}>
      {facet.options.map((option) => {
        const count = counts[option.value] ?? 0;
        const isPicked = picked.includes(option.value);

        return (
          <ListBox.Item
            key={option.value}
            id={option.value}
            textValue={option.label}
            // A selected option stays enabled whatever its count — disabling it would make it impossible
            // to deselect, which is the one state this rule must not create.
            isDisabled={count === 0 && !isPicked}
            className={`fluid-sm data-hovered:bg-hover data-hovered:text-brand flex cursor-pointer flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-1.5 font-bold transition-colors duration-(--motion-fast) ${
              count === 0 ? "text-foreground-muted" : "text-foreground"
            }`}>
            <span className="min-w-0 truncate">{option.label}</span>
            <span className={`${COUNT_BADGE} bg-brand/50 text-foreground shrink-0`}>{count}</span>
          </ListBox.Item>
        );
      })}
    </ListBox>
  );
}

/**
 * What an inline trigger reads: the picked value when exactly one is picked, the dimension otherwise.
 *
 * Above one pick the dimension keeps the words and the badge beside it carries the number — a count
 * spelled into the label would be a second numeric idiom for what the app already has a badge for.
 */
function triggerLabel<TItem>(facet: Facet<TItem>, picked: readonly string[]): string {
  if (picked.length !== 1) return facet.label;
  return facet.options.find((option) => option.value === picked[0])?.label ?? facet.label;
}

/** What the trigger is called aloud: the dimension, what it holds, and what pressing it does. */
function triggerHint<TItem>(facet: Facet<TItem>, picked: readonly string[], label: string): string {
  if (picked.length === 0) return `${facet.label} filtern`;
  if (picked.length === 1) return `${facet.label}: ${label} ändern`;
  return `${facet.label}: ${String(picked.length)} ausgewählt, ändern`;
}

/**
 * One dimension, as one control that carries its own state.
 *
 * **A trigger stays a trigger.** The shell is `CONTROL_BOX` in both states, so an active dimension is
 * still one of the controls beside it rather than a second kind of object in the row.
 *
 * **What being active changes is the CONTENT**: the picked value stands where the dimension's name
 * stood, a count badge carries how many above one pick, and the trailing slot that opens the menu
 * becomes the × that clears the dimension. Nothing about the box moves, so nothing reflows but the
 * words. That is what makes a chip strip unnecessary rather than merely unwanted — the trigger IS the
 * state, and a second drawing of it would be the duplication this control does without.
 *
 * `isStatic` renders the same box without a menu, for the hidden row that measures what fits.
 */
function FacetTrigger<TItem>({
  facet,
  items,
  facets,
  selection,
  onSelect,
  onClear,
  isNarrow,
  isStatic = false,
}: {
  facet: Facet<TItem>;
  items: TItem[];
  facets: readonly Facet<TItem>[];
  selection: FacetSelection;
  onSelect: (values: string[]) => void;
  onClear: () => void;
  isNarrow: boolean;
  isStatic?: boolean;
}) {
  const picked = selection[facet.param] ?? [];
  const isActive = picked.length > 0;
  const label = triggerLabel(facet, picked);

  // Only a picked value is capped. A dimension's name is authored, closed and short; a club or venue
  // name is data of no fixed length, and one long enough to push the row sideways is what this bounds.
  const cap = picked.length === 1 ? (isNarrow ? VALUE_CAP_NARROW : VALUE_CAP_WIDE) : "";

  // Both states come to the same width, so going active reflows nothing: 8 + 14 + 12 against 6 + 28.
  // Colour is picked rather than appended — two colour utilities in one attribute are settled by
  // CSS order, not by intent.
  const face = `flex cursor-pointer flex-row items-center gap-x-2 pl-3 whitespace-nowrap transition-colors duration-(--motion-fast) ${
    isActive ? "text-brand pr-1.5" : "text-foreground pr-3"
  }`;

  const content = (
    <>
      {/* Clipped visually and never in the name: `triggerHint` builds the `aria-label` from the whole
          string, and an `aria-label` is the accessible name outright, so what is announced is the value
          in full whatever the ellipsis shows. */}
      <span className={`truncate ${cap}`}>{label}</span>
      {picked.length > 1 && <span className={`${COUNT_BADGE} bg-brand/50 text-foreground shrink-0`}>{picked.length}</span>}
      {!isActive && (
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 shrink-0"
        />
      )}
    </>
  );

  if (isStatic) {
    return (
      <div className={TRIGGER_SHELL}>
        <span className={face}>{content}</span>
        {isActive && (
          <span className={CLEAR_FACE}>
            <Xmark
              aria-hidden="true"
              className="size-3.5 shrink-0"
            />
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={TRIGGER_SHELL}>
      <Popover>
        <Popover.Trigger
          aria-label={triggerHint(facet, picked, label)}
          className={`${face} hover:bg-hover h-full`}>
          {content}
        </Popover.Trigger>
        <Popover.Content
          placement="bottom start"
          offset={8}>
          <Popover.Dialog className={`${overlayPanel()} w-max max-w-[min(92vw,22rem)] min-w-52 overflow-hidden p-1.5 outline-none`}>
            <FacetOptions
              facet={facet}
              items={items}
              facets={facets}
              selection={selection}
              onSelect={onSelect}
            />
          </Popover.Dialog>
        </Popover.Content>
      </Popover>

      {/* Inside the shell rather than in the menu: clearing one dimension is the commonest thing done to
          an active filter, and a control reached by first opening the thing it undoes is not one. It
          costs no width — it stands where the chevron stands on an idle trigger. */}
      {isActive && (
        <Button
          variant="ghost"
          aria-label={`Filter ${facet.label} entfernen`}
          onPress={onClear}
          className={`${CLEAR_FACE} text-foreground-muted data-hovered:bg-hover-danger data-hovered:text-danger-strong min-w-0 cursor-pointer transition-colors duration-(--motion-fast)`}>
          <Xmark
            aria-hidden="true"
            className="size-3.5 shrink-0"
          />
        </Button>
      )}
    </div>
  );
}

/** The overflow control's two label forms — the dimensions by name, and the same thing counted. */
function overflowNames<TItem>(overflowed: readonly Facet<TItem>[]): string {
  return overflowed.map((facet) => facet.label).join(", ");
}
function overflowCount<TItem>(overflowed: readonly Facet<TItem>[]): string {
  return `Weitere Filter · ${String(overflowed.length)}`;
}

/**
 * The overflow trigger's contents, shared by the live control and by the hidden row that measures it.
 *
 * **On a narrow row it is the icon and nothing else** — a square the width of its own height, where the
 * words and the chevron would cost most of a phone's remaining room to say what the icon says. The live
 * control's `aria-label` names the dimensions in every case, so that is what the control is called when
 * there is no visible text left to read.
 */
function OverflowFace({ label, isNarrow }: { label: string; isNarrow: boolean }) {
  if (isNarrow)
    return (
      <Sliders
        aria-hidden="true"
        width={16}
        height={16}
      />
    );

  return (
    <>
      <Sliders
        aria-hidden="true"
        width={16}
        height={16}
      />
      {label}
      <ChevronDown
        aria-hidden="true"
        className="size-3.5 shrink-0"
      />
    </>
  );
}

/**
 * The filter control as one trigger per dimension: the Filterleiste.
 *
 * **The control and the state are one object.** There is no chip strip, because an active dimension is
 * its own trigger — which is why the constraints the chips carried (the shared height, the sideways
 * scroll, the lighter fill, the grouping per facet) stop applying rather than get better answers.
 *
 * **`primary` names the dimensions this SURFACE keeps in the row**, and `splitPromotedFacets` carries
 * why that is explicit, why it belongs to the surface, and what an undeclared surface gets. A narrow
 * row keeps one fewer of them, and the surface's own declaration says which one it gives up.
 *
 * **How many actually sit in the row is measured, not declared.** A hidden copy of the candidates is
 * laid out at full size and the row takes as many as fit beside the promoted ones; what is left goes
 * behind one control that NAMES those dimensions whenever the remaining width allows, and counts them
 * only when it does not. Nothing about the fit feeds back into the hidden copy, so the measurement
 * cannot oscillate — and the row's own width, which decides the narrow case, is a width no promotion
 * and no label form can change.
 *
 * **A surface with no overflow candidates renders no overflow control and no popover at all** — the
 * five surfaces carrying three facets or fewer are that case.
 *
 * **The overflow control is parked at the row's right edge by an auto margin**, so the triggers stay
 * grouped at the left with their own spacing. `justify-between` on the row would have spread those
 * apart as well, and a `grow` spacer would be a flex item — the row's gap would land on both sides of
 * it and cost 8px more than the leftover it exists to distribute, precisely once the row has overflowed
 * and has no leftover at all. An auto margin resolves to zero there and leaves the gap untouched.
 * Nothing about it reaches the measurement: `offsetWidth` is a border box, so no margin was ever in it.
 */
export function FilterLeiste<TItem>({
  facets,
  items,
  primary,
}: {
  /** Must be a module-scope constant, for the reason `AdminCrudView`'s `searchKeys` must be. */
  facets: readonly Facet<TItem>[];
  /** Every row before filtering, so each option can say what it would leave. */
  items: TItem[];
  /** The params this surface keeps in the row. Undefined promotes every dimension. */
  primary?: readonly string[];
}) {
  const { selection, activeCount, setFacet, clearFacet, clearAll } = useUrlFilters(facets);

  const viewportRef = useRef<HTMLDivElement>(null);
  const promotedRef = useRef<HTMLDivElement>(null);
  const candidateRulerRef = useRef<HTMLDivElement>(null);
  const namesRulerRef = useRef<HTMLDivElement>(null);
  const countRulerRef = useRef<HTMLDivElement>(null);

  // Everything inline and nothing narrow until measured, so a first paint with room is already right
  // and a narrow one scrolls for a frame rather than flashing a control. `Infinity` is "as many as
  // there are", which this cannot count yet.
  const [row, setRow] = useState<{ pulled: number; namesFit: boolean; isNarrow: boolean }>({
    pulled: Infinity,
    namesFit: true,
    isNarrow: false,
  });

  const { inline, overflowable } = splitPromotedFacets(facets, primary, selection, row.isNarrow);

  const candidateCount = overflowable.length;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;

    const measure = () => {
      const candidates = [...(candidateRulerRef.current?.children ?? [])].map((node) => (node as HTMLElement).offsetWidth);
      const names = [...(namesRulerRef.current?.children ?? [])].map((node) => (node as HTMLElement).offsetWidth);
      const counts = [...(countRulerRef.current?.children ?? [])].map((node) => (node as HTMLElement).offsetWidth);
      if (candidates.length !== candidateCount) return;

      const promotedWidth = promotedRef.current?.offsetWidth ?? 0;

      // Measured even where there is nothing to pull, because a surface can have no candidate at all
      // until the row is narrow enough to demote one — which is a width, and this is where widths are.
      setRow({
        ...fitOverflow({
          available: viewport.clientWidth - promotedWidth - (promotedWidth > 0 ? TRIGGER_GAP : 0),
          candidates,
          namesWidths: names,
          countWidths: counts,
          gap: TRIGGER_GAP,
        }),
        isNarrow: isNarrowRow(viewport.clientWidth),
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => {
      observer.disconnect();
    };
    // The ruler's contents decide every width, so re-measuring keys on what it renders.
  }, [candidateCount, facets, selection, items]);

  if (facets.length === 0) return null;

  const pulled = overflowable.slice(0, Math.min(row.pulled, candidateCount));
  const overflowed = overflowable.slice(pulled.length);
  const label = row.namesFit ? overflowNames(overflowed) : overflowCount(overflowed);

  const renderTrigger = (facet: Facet<TItem>, isStatic = false) => (
    <FacetTrigger
      key={facet.param}
      facet={facet}
      items={items}
      facets={facets}
      selection={selection}
      isNarrow={row.isNarrow}
      isStatic={isStatic}
      onSelect={(values) => {
        setFacet(facet.param, values);
      }}
      onClear={() => {
        clearFacet(facet.param);
      }}
    />
  );

  return (
    <div className="relative flex w-full flex-col gap-2">
      {/* Sideways rather than wrapping, for `FilterBar`'s own reason: on Spielsuche this row sits in a
          sticky band, so a second line would cost viewport height for the whole scroll of the result
          list. It is also the escape hatch when even the promoted dimensions outgrow a phone. */}
      <ScrollShadow
        orientation="horizontal"
        size={24}
        hideScrollBar
        className="w-full min-w-0">
        <div
          ref={viewportRef}
          className="flex w-full flex-row items-center gap-2">
          <div
            ref={promotedRef}
            className="flex flex-row items-center gap-2">
            {inline.map((facet) => renderTrigger(facet))}
          </div>

          {pulled.map((facet) => renderTrigger(facet))}

          {overflowed.length > 0 && (
            <Popover>
              {/* The label names the dimensions whatever the row does with it, because on a narrow row
                  it is the only name this control has. `ml-auto` is the component docstring's; it is
                  here and not in `OVERFLOW_SHELL` because the hidden rulers wear that too. */}
              <Popover.Trigger
                aria-label={`Weitere Filter: ${overflowNames(overflowed)}`}
                className={`${OVERFLOW_SHELL} hover:bg-hover ml-auto transition-colors duration-(--motion-fast)`}>
                <OverflowFace
                  label={label}
                  isNarrow={row.isNarrow}
                />
              </Popover.Trigger>
              <Popover.Content
                placement="bottom start"
                offset={8}>
                <Popover.Dialog className={`${overlayPanel()} w-[92vw] overflow-hidden p-0 outline-none sm:w-[min(92vw,40rem)]`}>
                  <div className="scrollbar-line max-h-[70vh] overflow-x-hidden overflow-y-auto p-3">
                    <div className="flex flex-row flex-wrap gap-3">
                      {overflowed.map((facet) => (
                        <div
                          key={facet.param}
                          className="border-border/70 flex w-max max-w-full min-w-44 flex-col gap-y-1 rounded-xl border p-1.5">
                          <span className="fluid-xxs text-foreground-muted px-1.5 font-bold tracking-widest uppercase">{facet.label}</span>
                          <FacetOptions
                            facet={facet}
                            items={items}
                            facets={facets}
                            selection={selection}
                            onSelect={(values) => {
                              setFacet(facet.param, values);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </Popover.Dialog>
              </Popover.Content>
            </Popover>
          )}
        </div>
      </ScrollShadow>

      {/* The hidden row the fit is read from. It renders what the decision does NOT depend on — every
          candidate at full width, and both label forms for every possible overflow — so collapsing the
          live row can never change what was measured. */}
      {candidateCount > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none invisible absolute h-0 overflow-hidden">
          {/* Each row is a flex container so every child sizes to its OWN content — inside a plain block
              they would all take the widest child's width and the measurement would say nothing. */}
          <div
            ref={candidateRulerRef}
            className="flex flex-row">
            {overflowable.map((facet) => renderTrigger(facet, true))}
          </div>
          <div
            ref={namesRulerRef}
            className="flex flex-row">
            {overflowable.map((_, index) => (
              <span
                key={index}
                className={OVERFLOW_SHELL}>
                <OverflowFace
                  label={overflowNames(overflowable.slice(candidateCount - index - 1))}
                  isNarrow={row.isNarrow}
                />
              </span>
            ))}
          </div>
          <div
            ref={countRulerRef}
            className="flex flex-row">
            {overflowable.map((_, index) => (
              <span
                key={index}
                className={OVERFLOW_SHELL}>
                <OverflowFace
                  label={overflowCount(overflowable.slice(candidateCount - index - 1))}
                  isNarrow={row.isNarrow}
                />
              </span>
            ))}
          </div>
        </div>
      )}

      {activeCount > 1 && (
        <Button
          variant="ghost"
          onPress={clearAll}
          className="border-border text-foreground-muted data-hovered:bg-hover-danger data-hovered:text-danger-strong fluid-xxs flex h-7 shrink-0 cursor-pointer flex-row items-center gap-x-1.5 self-start rounded-lg border px-2.5 font-bold transition-colors duration-(--motion-fast)">
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
