"use client";

/**
 * CORE · what a toast looks like
 *
 * The app's toast region, mounted once in `RootProviders` above the router so a toast survives the
 * navigation that raised it. `shared/utils/appToast.ts` is the other half of the pair — it owns what
 * a toast says and for how long, this owns how one is built.
 *
 * **It lives in `core` because `RootProviders` mounts it**, and `core` may not import from `shared`
 * (ADR-0012). The dependency runs one way only: producers across `features` and `shared` call
 * `appToast`, nothing imports this file except the provider beside it.
 *
 * **The markup is ours, not HeroUI's, and that is the durability argument.** `Toast.Provider` takes a
 * `children` render function that replaces its default composition entirely
 * ([the documented extension point](https://www.heroui.com/docs/react/components/toast)), so the
 * structure below is ordinary TSX that the type checker, the linter and the formatter all read. The
 * alternative — leaving HeroUI's composition in place and overriding its appearance from
 * `globals.css` — reaches the same pixels through selectors that are vendored implementation detail,
 * and an upgrade that renames one of them takes the styling with it and reports nothing
 * (ADR-0053).
 *
 * **What is still in `globals.css`, and why it has to be**: the `.toast` shell itself (HeroUI writes
 * its `class`, so there is no element here to put a class on), and the close button's visibility,
 * which must stay keyed on `[data-frontmost]` — see the block there. Those two are the whole CSS
 * surface, they are written against **HeroUI 3.2.3**, and they are what an upgrade has to be checked
 * against.
 *
 * **One stylesheet is enough for both surfaces.** `toast.css` is imported by `globals.css`, which
 * loads on every route, so a toast raised on `/admin` is already styled — `admin.css` must not gain a
 * second copy (ADR-0023).
 */
import { CircleCheck, CircleInfo, CircleXmark, TriangleExclamation } from "@gravity-ui/icons";
import { tv } from "tailwind-variants";

import { Spinner, Toast } from "@heroui/react";

/**
 * Severity, expressed the way every other feedback surface on this site expresses it: the plain
 * accent as a `/15` tint behind the glyph, its `-strong` companion for the glyph itself, and the
 * plain accent again for the timer bar, which is a fill rather than text.
 *
 * That is the pairing `globals.css` measured the accent tokens against, and it is the same recipe
 * `Callout` and the delete dialog's icon tile use — a toast is the transient member of that family,
 * not a fourth vocabulary.
 */
const toastCard = tv({
  slots: {
    tile: "flex size-9 shrink-0 items-center justify-center rounded-xl",
    icon: "size-5",
    /** Sits on the shell's bottom edge; `origin-left` is what makes the scaleX read as draining. */
    timer: "toast__timer absolute inset-x-0 bottom-0 h-[3px] origin-left",
  },
  variants: {
    variant: {
      default: { tile: "bg-muted", icon: "text-foreground-muted", timer: "bg-foreground-muted/40" },
      accent: { tile: "bg-info/15", icon: "text-info-strong", timer: "bg-info" },
      success: { tile: "bg-success/15", icon: "text-success-strong", timer: "bg-success" },
      warning: { tile: "bg-warning/15", icon: "text-warning-strong", timer: "bg-warning" },
      danger: { tile: "bg-danger/15", icon: "text-danger-strong", timer: "bg-danger" },
    },
  },
  defaultVariants: { variant: "default" },
});

/**
 * **`danger` gets its own glyph here, and `Callout` deliberately shares one.** That difference is not
 * drift: a callout's warning and danger are both consequences of an edit and differ only in degree,
 * which is why a second shape there would imply a category that does not exist. A toast's `danger`
 * says the thing did not happen at all — a different kind of statement from `warning`'s "it happened
 * and it cost something" — so the two earn different shapes.
 */
const ICONS = {
  default: CircleInfo,
  accent: CircleInfo,
  success: CircleCheck,
  warning: TriangleExclamation,
  danger: CircleXmark,
} as const;

export function AppToaster() {
  return (
    <Toast.Provider
      // 420 over HeroUI's 460: the description is the part that wraps, and a narrower measure reads
      // faster than a wide one. Below `sm` the region's own rule takes over at viewport width - 2rem.
      width={420}
      gap={10}
      maxVisibleToasts={3}
      placement="bottom">
      {({ toast: queued }) => {
        const { actionProps, description, indicator, isLoading, title, variant = "default" } = queued.content;
        const styles = toastCard({ variant });
        const Icon = ICONS[variant];

        // Only a toast that actually closes itself gets a timer bar. A pending toast is closed by its
        // own key when the answer arrives (`appToast.pending`), and drawing a bar that never drains
        // would promise a deadline nothing is counting down to.
        const timeout = queued.timeout;
        const hasTimer = !isLoading && typeof timeout === "number" && timeout > 0;

        return (
          <Toast
            toast={queued}
            variant={variant}
            placement="bottom">
            <Toast.Indicator
              variant={variant}
              className={styles.tile()}>
              {isLoading ? (
                <Spinner
                  color="current"
                  size="sm"
                />
              ) : (
                (indicator ?? <Icon className={styles.icon()} />)
              )}
            </Toast.Indicator>

            <Toast.Content className="flex min-w-0 flex-1 flex-col items-start gap-1">
              {!!title && <Toast.Title className="fluid-sm text-foreground font-bold">{title}</Toast.Title>}
              {!!description && (
                <Toast.Description className="fluid-xs text-foreground-muted leading-normal font-medium opacity-100">
                  {description}
                </Toast.Description>
              )}
              {!!actionProps?.children && (
                <Toast.ActionButton
                  {...actionProps}
                  variant="primary"
                  // The site's affirmative treatment, at the compact end of the scale. A toast has one
                  // action and it is always the way out of what the toast just reported, so it takes
                  // the brand fill every other affirmative control takes — never a severity colour,
                  // which would read as "this button is the danger".
                  className="bg-brand-solid text-brand-solid-foreground fluid-xs hover:bg-brand-solid/90 mt-1 h-9 rounded-lg px-4 font-semibold transition-colors">
                  {actionProps.children}
                </Toast.ActionButton>
              )}
            </Toast.Content>

            {/* `inset-auto` is load-bearing: HeroUI parks this control outside the shell's top-right
                corner, and the redesign brings it back into the row. Its visibility is NOT set here —
                see the `[data-frontmost]` note in `globals.css`. */}
            <Toast.CloseButton
              aria-label="Benachrichtigung schließen"
              className="text-foreground-muted hover:text-foreground hover:bg-muted relative inset-auto size-8 shrink-0 rounded-lg border-0 bg-transparent transition-colors"
            />

            {hasTimer && (
              <span
                aria-hidden="true"
                className={styles.timer()}
                style={{ animationDuration: `${timeout}ms` }}
              />
            )}
          </Toast>
        );
      }}
    </Toast.Provider>
  );
}
