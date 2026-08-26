import { EditPageHeader } from "@/shared/components/ui/EditPageHeader";

import type { EditPageHeaderContent } from "@/shared/components/ui/EditPageHeader";
import type { ReactNode } from "react";

/**
 * An edit page's frame, inside the `Form` and above the action bar: **one scroll container**, so the
 * bar below stays a static sibling of the scrolling content rather than floating over it.
 */
export function EditFormLayout({
  header,
  onLeave,
  isLeaving,
  rail,
  children,
}: {
  /** Data slots, never a node: a header the caller composes is one nobody owns. */
  header: EditPageHeaderContent;
  /** The form's `requestLeave`, so the pill and Abbrechen route through one discard guard. */
  onLeave: () => void;
  /**
   * True while `leavePage` runs. react-aria ends hover the moment a control turns disabled, and no
   * `pointerleave` follows a click that leaves, so without it the pill returns painted hovered.
   */
  isLeaving: boolean;
  rail: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-0 w-full flex-1 scrollbar-gutter-stable overflow-y-auto px-4 pt-6 pb-10 sm:px-8">
      <div className="max-w-page mx-auto flex w-full flex-col">
        <EditPageHeader
          {...header}
          onLeave={onLeave}
          isLeaving={isLeaving}
        />

        {/* Splits at `xl`, not `lg`: the admin sidemenu leaves too little beside the rail. */}
        <div className="grid w-full grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start 2xl:grid-cols-[minmax(0,1fr)_380px] 2xl:gap-8">
          {/* Explicit grid placement, not `order-*`: DOM order is the mobile reading order, and on a
              phone the rail's warnings belong above the fields rather than below every panel. */}
          <div className="w-full xl:sticky xl:top-6 xl:col-start-2 xl:row-start-1 xl:self-start">{rail}</div>

          <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 xl:col-start-1 xl:row-start-1 xl:mx-0 xl:max-w-none">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
