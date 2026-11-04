import type { ReactNode } from "react";

/**
 * Sentence case, never letter-spaced capitals: those are the label voice, belonging to an eyebrow
 * rather than to prose read end to end.
 */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-y-2">
      <h2 className="fluid-lg font-extrabold text-foreground">{title}</h2>
      {children}
    </section>
  );
}
