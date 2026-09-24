import Plus from "@gravity-ui/icons/Plus";

import { buttonVariants } from "@heroui/styles";

import { AdminCrudFallback } from "./AdminCrudFallback";
import { AdminCrudShell } from "./AdminCrudShell";
import { formButton } from "./formButtons";
import { skeletonBlock } from "./skeleton";

import type { AdminCrudShape } from "./AdminCrudFallback";

/** The bar beside the trigger takes what the trigger leaves, so a stand-in of any other width moves it when the trigger arrives. */
export function CreateTriggerPlaceholder({ label }: { label: string }) {
  return (
    // The trigger's own classes, HeroUI's half included, around its own glyph and words, laid out and never
    // painted: HeroUI's rule pulls the glyph in at both sides, so a stand-in for it is a box of another width.
    <div
      aria-hidden="true"
      className={`${buttonVariants()} ${formButton({ intent: "trigger" })} invisible`}>
      <Plus
        aria-hidden="true"
        className="size-4.5"
      />
      <span className="max-sm:sr-only">{label}</span>
      {/* The corners inherited, the seam's squared ones below `sm` included. */}
      <span className={`${skeletonBlock()} visible absolute inset-0 cursor-default rounded-[inherit]`} />
    </div>
  );
}

/**
 * What an admin list route's `loading.tsx` draws, inside the page's own shell: the page replaces it whole, so
 * a placeholder outside the shell moves by the gutter and the search row when the page arrives.
 */
export function AdminCrudLoading({
  shape = "table",
  hasFacets = true,
  createLabel,
}: {
  shape?: AdminCrudShape;
  hasFacets?: boolean;
  /**
   * The create trigger's words, passed exactly where the page's shell passes a `createModal`. The trigger's width
   * is its words', and the bar beside it takes what the trigger leaves, so without them the bar moves on arrival.
   */
  createLabel?: string;
}) {
  const hasTrigger = createLabel !== undefined;

  return (
    <AdminCrudShell
      // `SearchBar`'s own height at every breakpoint, and `AdminCrudSearch`'s width for the same `attachEnd`: the
      // seam's squared corners included, below `sm`, where the bar joins the trigger.
      search={
        <div
          className={`${skeletonBlock()} h-12 rounded-xl lg:h-15 ${hasTrigger ? "min-w-0 flex-1 max-sm:rounded-r-none sm:max-w-md" : "w-full min-w-0"}`}
        />
      }
      createModal={hasTrigger ? <CreateTriggerPlaceholder label={createLabel} /> : undefined}>
      <AdminCrudFallback
        shape={shape}
        hasFacets={hasFacets}
      />
    </AdminCrudShell>
  );
}
