"use client";

import { useEffect, useRef, useState } from "react";

import { ChevronDown, Sliders, Xmark } from "@gravity-ui/icons";

import { Button, ListBox, Popover, ScrollShadow } from "@heroui/react";

import { useUrlFilters } from "@/shared/hooks/useUrlFilters";
import { countFacetOptions, splitPromotedFacets } from "@/shared/utils/facets";

import { COUNT_BADGE } from "./badges";
import { fitOverflow } from "./filterLeisteFit";
import { overlayPanel } from "./overlayPanel";

import type { Facet, FacetSelection } from "@/shared/utils/facets";
import type { Selection } from "@heroui/react";

/** `gap-2` between two triggers, in pixels, because the fit is arithmetic and CSS cannot report it. */
const TRIGGER_GAP = 8;

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

/** What an inline trigger reads: the value itself when one is picked, the dimension and a count above that. */
function triggerLabel<TItem>(facet: Facet<TItem>, picked: readonly string[]): string {
  if (picked.length === 0) return facet.label;
  if (picked.length === 1) return facet.options.find((option) => option.value === picked[0])?.label ?? facet.label;
  return `${facet.label} · ${String(picked.length)}`;
}

/**
 * One dimension, as one control that carries its own state.
 *
 * **The trigger IS the chip.** An active one takes the chip's anatomy exactly — the value, a hairline,
 * a × that clears the dimension — with the label half now opening the menu rather than doing nothing.
 * That is the whole argument for this concept: the panel and the chip strip were two representations of
 * one state, and every constraint on the chips followed from the duplication.
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
  isStatic = false,
}: {
  facet: Facet<TItem>;
  items: TItem[];
  facets: readonly Facet<TItem>[];
  selection: FacetSelection;
  onSelect: (values: string[]) => void;
  onClear: () => void;
  isStatic?: boolean;
}) {
  const picked = selection[facet.param] ?? [];
  const isActive = picked.length > 0;
  const label = triggerLabel(facet, picked);

  const shell = `fluid-xs flex h-10 shrink-0 flex-row items-stretch overflow-hidden rounded-xl font-bold ${
    isActive ? "bg-brand/10" : "border-border bg-surface border shadow-sm"
  }`;
  const face =
    "text-foreground flex cursor-pointer flex-row items-center gap-x-2 px-3 whitespace-nowrap transition-colors duration-(--motion-fast)";

  if (isStatic) {
    return (
      <div className={shell}>
        <span className={face}>
          {label}
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 shrink-0"
          />
        </span>
        {isActive && (
          <>
            <span className="bg-brand/25 w-px shrink-0" />
            <span className="flex w-7 shrink-0 items-center justify-center" />
          </>
        )}
      </div>
    );
  }

  return (
    <div className={shell}>
      <Popover>
        <Popover.Trigger
          aria-label={isActive ? `${facet.label}: ${label} ändern` : `${facet.label} filtern`}
          className={`${face} hover:bg-hover h-full`}>
          {label}
          <ChevronDown
            aria-hidden="true"
            className="size-3.5 shrink-0"
          />
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

      {isActive && (
        <>
          <span
            aria-hidden="true"
            className="bg-brand/25 w-px shrink-0"
          />
          <Button
            variant="ghost"
            aria-label={`Filter ${facet.label} entfernen`}
            onPress={onClear}
            className="text-foreground-muted data-hovered:bg-hover-danger data-hovered:text-danger-strong flex h-full w-7 min-w-0 shrink-0 cursor-pointer items-center justify-center rounded-none p-0 transition-colors duration-(--motion-fast)">
            <Xmark
              aria-hidden="true"
              className="size-3.5 shrink-0"
            />
          </Button>
        </>
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

/** The overflow trigger's box, shared by the live control and by the hidden row that measures it. */
function OverflowFace({ label }: { label: string }) {
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

const OVERFLOW_SHELL =
  "border-border bg-surface text-foreground fluid-xs flex h-10 shrink-0 cursor-pointer flex-row items-center gap-x-2 rounded-xl border px-3 font-bold whitespace-nowrap shadow-sm";

/**
 * The filter control as one trigger per dimension: the Filterleiste.
 *
 * **The control and the state are one object.** There is no chip strip, because an active dimension is
 * its own trigger — which is why the constraints the chips carried (the shared height, the sideways
 * scroll, the lighter fill, the grouping per facet) stop applying rather than get better answers.
 *
 * **`primary` names the dimensions this SURFACE keeps in the row**, and `splitPromotedFacets` carries
 * why that is explicit, why it belongs to the surface, and what an undeclared surface gets.
 *
 * **How many actually sit in the row is measured, not declared.** A hidden copy of the candidates is
 * laid out at full size and the row takes as many as fit beside the promoted ones; what is left goes
 * behind one control that NAMES those dimensions whenever the remaining width allows, and counts them
 * only when it does not. Nothing about the fit feeds back into the hidden copy, so the measurement
 * cannot oscillate.
 *
 * **A surface with no overflow candidates renders no overflow control and no popover at all** — the
 * five surfaces carrying three facets or fewer are that case.
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

  const { inline, overflowable } = splitPromotedFacets(facets, primary, selection);

  // Everything inline until measured, so the first paint is already right wherever the row has room and
  // the narrow case merely scrolls for one frame rather than showing an overflow control that vanishes.
  const [fit, setFit] = useState<{ pulled: number; namesFit: boolean }>({ pulled: overflowable.length, namesFit: true });

  const candidateCount = overflowable.length;

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null || candidateCount === 0) return;

    const measure = () => {
      const candidates = [...(candidateRulerRef.current?.children ?? [])].map((node) => (node as HTMLElement).offsetWidth);
      const names = [...(namesRulerRef.current?.children ?? [])].map((node) => (node as HTMLElement).offsetWidth);
      const counts = [...(countRulerRef.current?.children ?? [])].map((node) => (node as HTMLElement).offsetWidth);
      if (candidates.length !== candidateCount) return;

      const promotedWidth = promotedRef.current?.offsetWidth ?? 0;

      setFit(
        fitOverflow({
          available: viewport.clientWidth - promotedWidth - (promotedWidth > 0 ? TRIGGER_GAP : 0),
          candidates,
          namesWidths: names,
          countWidths: counts,
          gap: TRIGGER_GAP,
        }),
      );
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

  const pulled = overflowable.slice(0, Math.min(fit.pulled, candidateCount));
  const overflowed = overflowable.slice(pulled.length);
  const label = fit.namesFit ? overflowNames(overflowed) : overflowCount(overflowed);

  const renderTrigger = (facet: Facet<TItem>, isStatic = false) => (
    <FacetTrigger
      key={facet.param}
      facet={facet}
      items={items}
      facets={facets}
      selection={selection}
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
              <Popover.Trigger
                aria-label={`Weitere Filter: ${overflowNames(overflowed)}`}
                className={`${OVERFLOW_SHELL} hover:bg-hover transition-colors duration-(--motion-fast)`}>
                <OverflowFace label={label} />
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
                <OverflowFace label={overflowNames(overflowable.slice(candidateCount - index - 1))} />
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
                <OverflowFace label={overflowCount(overflowable.slice(candidateCount - index - 1))} />
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
