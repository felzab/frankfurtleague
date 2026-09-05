import { DISPLAY_HEADING } from "@/shared/components/ui/displayType";

import type { ReactNode } from "react";

/**
 * One component for the brand pages' sections, so the heading level and the eyebrow's spelling
 * cannot drift between them.
 */
export function MetaSection({
  eyebrow,
  title,
  lead,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex w-full flex-col gap-y-4">
      <div className="flex flex-col gap-x-6 gap-y-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-y-1">
          <span className="fluid-xxs text-brand font-extrabold tracking-widest uppercase">{eyebrow}</span>
          <h2 className={`${DISPLAY_HEADING} fluid-2xl text-foreground`}>{title}</h2>
          {lead !== undefined && <p className="muted-hint max-w-2xl">{lead}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
