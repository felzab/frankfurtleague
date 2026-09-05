import type { ReactNode } from "react";

/**
 * Sentence case, never letter-spaced capitals: those are the label voice, belonging to an eyebrow
 * rather than to prose read end to end. The step sits below
 * `fl_frontend/src/features/meta/components/ui/MetaSection.tsx`'s, a dozen sections at that size
 * reading as a dozen pages.
 */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-y-2">
      <h2 className="fluid-lg text-foreground font-extrabold">{title}</h2>
      {children}
    </section>
  );
}
