"use client";

import { useId, useState } from "react";

import { ChevronDown } from "@gravity-ui/icons";

import { card } from "@/shared/components/ui/card";

import type { ReactNode } from "react";

/**
 * One collapsible card in a page-owned form's summary rail — the match editor's and the team
 * editor's both.
 *
 * **Collapsible because the rail is above the form on a phone.** On desktop the rail sits in its own
 * sticky column and costs nothing; below `xl` it is in flow between the header and the first field, so
 * three expanded cards put the whole form a scroll away from the top of the page. Each one folds, and
 * the two that are review surfaces start folded on a phone — see `defaultOpenOnMobile`.
 *
 * **The fold control is an overlay button, and the layout is why.** The header row holds the title,
 * its `InfoHint`, the badge and the chevron; the InfoHint must sit NEXT TO the title (fourth
 * review) and must stay its own interactive element — nesting it in a `<button>` is two controls in
 * one. So the button is an absolutely-positioned cover labelled by the heading, everything decorative
 * is `pointer-events-none` so clicks fall through to it, and the InfoHint alone stacks above it.
 *
 * **The default differs by viewport, and it is resolved once on mount rather than by a media query.**
 * A CSS-driven default cannot be overridden by a press: the moment the admin opens a card the state has
 * to be theirs, and a rule keyed on width would fight them on the next resize. `matchMedia` is read in
 * the initialiser so the first paint is already right. A caller that needs to drive the state — the
 * warnings card folds itself when its last banner clears — passes `isOpen`/`onToggle` instead, and the
 * internal state stands down entirely.
 */
export function RailSection({
  title,
  badge,
  info,
  defaultOpenOnMobile = true,
  isOpen: controlledOpen,
  onToggle,
  children,
}: {
  title: string;
  /** Rendered between the title and the chevron — a count, usually. Visible while collapsed. */
  badge?: ReactNode;
  /** An `InfoHint`, rendered directly beside the title. */
  info?: ReactNode;
  /**
   * Whether this card starts open on a narrow screen. Desktop always starts open.
   *
   * `false` is for a card the admin consults rather than works from: the preview and the change list
   * are both answers to "what will I have done", which is a question asked at the end.
   */
  defaultOpenOnMobile?: boolean;
  /** Controlled mode, both or neither: the caller owns the state and this component only renders it. */
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
  children: ReactNode;
}) {
  const contentId = useId();
  const headingId = useId();

  const [internalOpen, setInternalOpen] = useState(() => {
    // `xl`, matching the breakpoint at which the rail becomes its own column. No `window` on the
    // server, and this initialiser does not run there.
    if (defaultOpenOnMobile || typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 80rem)").matches;
  });

  const isOpen = controlledOpen ?? internalOpen;
  const toggle = () => (onToggle ? onToggle(!isOpen) : setInternalOpen((open) => !open));

  return (
    <section className={`${card()} flex w-full flex-col`}>
      <div className="relative flex w-full flex-row items-center gap-x-2 px-4 py-3">
        {/* The whole-row press target. Empty on purpose: its accessible name is the heading beside
            it, and its visible content is the row it covers. */}
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          aria-labelledby={headingId}
          onClick={toggle}
          className="hover:bg-muted/40 absolute inset-0 cursor-pointer rounded-2xl transition-colors"
        />

        {/* The hint lives INSIDE the heading, as an inline glyph on the text's own baseline — the
            only alignment that reads right beside text (see `InfoHint`). The h2 passes clicks
            through to the overlay button; the hint alone takes its own. */}
        <h2 className="fluid-base text-foreground pointer-events-none relative font-extrabold tracking-tight">
          {/* The id sits on the title text alone, so the fold button's accessible name stays
              "Hinweise" and never swallows the hint trigger's own label. */}
          <span id={headingId}>{title}</span>
          {info && <span className="pointer-events-auto relative z-10">{info}</span>}
        </h2>
        {badge && <span className="pointer-events-none relative ml-auto">{badge}</span>}
        <ChevronDown
          className={`text-foreground-muted pointer-events-none relative size-4 shrink-0 transition-transform duration-200 ${badge ? "" : "ml-auto"} ${isOpen ? "rotate-180" : ""}`}
        />
      </div>

      {isOpen && (
        <div
          id={contentId}
          className="flex w-full flex-col gap-y-2 px-4 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}
