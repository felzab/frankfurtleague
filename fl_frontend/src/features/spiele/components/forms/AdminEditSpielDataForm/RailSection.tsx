"use client";

import { useId, useState } from "react";

import { ChevronDown } from "@gravity-ui/icons";

import { card } from "@/shared/components/ui/card";

import type { ReactNode } from "react";

/**
 * One collapsible card in the editor's rail.
 *
 * **Collapsible because the rail is above the form on a phone.** On desktop the rail sits in its own
 * sticky column and costs nothing; below `xl` it is in flow between the header and the first field, so
 * three expanded cards put the whole form a scroll away from the top of the page. Each one folds, and
 * the two that are review surfaces start folded on a phone — see `defaultOpenOnMobile`.
 *
 * **The default differs by viewport, and it is resolved once on mount rather than by a media query.**
 * A CSS-driven default cannot be overridden by a press: the moment the admin opens a card the state has
 * to be theirs, and a rule keyed on width would fight them on the next resize. `matchMedia` is read in
 * the initialiser so the first paint is already right, and after that the only thing that moves it is
 * the button. The reader is inside `useState`'s lazy initialiser, so it never runs during SSR.
 *
 * The whole header is the control, and it carries `aria-expanded` and `aria-controls` so the state is
 * announced rather than left to the chevron.
 */
export function RailSection({
  title,
  badge,
  defaultOpenOnMobile = true,
  children,
}: {
  title: string;
  /** Rendered between the title and the chevron — a count, usually. Visible while collapsed. */
  badge?: ReactNode;
  /**
   * Whether this card starts open on a narrow screen. Desktop always starts open.
   *
   * `false` is for a card the admin consults rather than works from: the preview and the change list
   * are both answers to "what will I have done", which is a question asked at the end.
   */
  defaultOpenOnMobile?: boolean;
  children: ReactNode;
}) {
  const contentId = useId();

  const [isOpen, setIsOpen] = useState(() => {
    // `xl`, matching the breakpoint at which the rail becomes its own column. No `window` on the
    // server, and this initialiser does not run there.
    if (defaultOpenOnMobile || typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 80rem)").matches;
  });

  return (
    <section className={`${card()} flex w-full flex-col`}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((open) => !open)}
        className="hover:bg-muted/40 flex w-full flex-row items-center gap-x-2 rounded-2xl px-4 py-3 text-left transition-colors">
        <h2 className="fluid-base text-foreground mr-auto font-extrabold tracking-tight">{title}</h2>
        {badge}
        <ChevronDown className={`text-foreground-muted size-4 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

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
