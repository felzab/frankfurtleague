import type { ReactNode } from "react";

/**
 * The heading is quiet rather than the display voice
 * `fl_frontend/src/features/meta/components/ui/MetaSection.tsx` sets: those pages carry three
 * sections and are read for an argument, these carry a dozen and are read for one clause.
 */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-y-2">
      <h2 className="fluid-base text-foreground font-extrabold tracking-wide uppercase">{title}</h2>
      {children}
    </section>
  );
}
