"use client";

import { useId, useState } from "react";

import { ChevronDown } from "@gravity-ui/icons";

import { card } from "@/shared/components/ui/card";

import type { ReactNode } from "react";

/**
 * **The fold control is an overlay button** labelled by the heading, everything decorative `pointer-events-none`: the
 * `InfoHint` stays its own control. **The mobile default resolves once on mount**, a CSS one being unoverridable.
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
  /** `false` for a card the admin consults rather than works from — an answer to "what will I have done". */
  defaultOpenOnMobile?: boolean;
  /** Controlled mode, both or neither: the caller owns the state and this component only renders it. */
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
  children: ReactNode;
}) {
  const contentId = useId();
  const headingId = useId();

  const [internalOpen, setInternalOpen] = useState(() => {
    // `xl`, the breakpoint at which the rail becomes its own column.
    if (defaultOpenOnMobile || typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 80rem)").matches;
  });

  const isOpen = controlledOpen ?? internalOpen;
  const toggle = () => (onToggle ? onToggle(!isOpen) : setInternalOpen((open) => !open));

  return (
    <section className={`${card()} flex w-full flex-col`}>
      <div className="relative flex w-full flex-row items-center gap-x-2 px-4 py-3">
        {/* Empty on purpose: its accessible name is the heading beside it and its visible content is the row it covers. */}
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={contentId}
          aria-labelledby={headingId}
          onClick={toggle}
          className="hover:bg-hover absolute inset-0 cursor-pointer rounded-2xl transition-colors"
        />

        {/* The h2 passes clicks through to the overlay button; the hint alone takes its own. */}
        <h2 className="fluid-base text-foreground pointer-events-none relative font-extrabold tracking-tight">
          {/* The id sits on the title text alone, so the fold button's name never swallows the hint trigger's. */}
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
