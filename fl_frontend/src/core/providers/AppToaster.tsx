"use client";

/**
 * CORE · what a toast looks like
 *
 * The app's toast region, mounted once in `RootProviders` above the router so a toast survives
 * the navigation that raised it; `shared/utils/appToast.ts` owns what one says and for how long.
 * In `core` because `RootProviders` mounts it and `core` may not import `shared` (ADR-0008).
 * The markup is ours through `Toast.Provider`'s children render function — ordinary TSX the
 * toolchain reads — rather than CSS overrides against vendored selectors (ADR-0043).
 *
 * Invariants:
 * - The CSS surface is exactly the two `globals.css` rules ADR-0043 names, written against
 *   HeroUI 3.2.3.
 * - One stylesheet serves both surfaces (ADR-0016) — `admin.css` must not gain a second copy.
 */
import { tv } from "tailwind-variants";

import { Spinner, Toast } from "@heroui/react";

/**
 * Severity, carried by two thin marks and nothing else (decided 2026-08-06).
 *
 * **There is no icon, and its absence is the design rather than an omission.** A glyph in a tinted
 * 36px tile is how a `Callout` announces itself, and a callout has to — it sits inside a page among
 * body text and needs to be found. A toast arrives alone over a dimmed page with the reader's eye
 * already on it, so the tile was restating what the border and the timer bar already say, at the cost
 * of a third of the toast's width.
 *
 * What is left is the coloured edge and the draining bar, both the plain accent. The border runs at
 * `/60` rather than the `/30` it used while the tile carried the grade: it is now the standing signal,
 * and it has to read at a glance on a surface that is otherwise neutral.
 */
const toastCard = tv({
  slots: {
    /** Sits on the shell's bottom edge; `origin-left` is what makes the scaleX read as draining. */
    timer: "toast__timer absolute inset-x-0 bottom-0 h-0.5 origin-left",
  },
  variants: {
    variant: {
      default: { timer: "bg-foreground-muted/40" },
      accent: { timer: "bg-info" },
      success: { timer: "bg-success" },
      warning: { timer: "bg-warning" },
      danger: { timer: "bg-danger" },
    },
  },
  defaultVariants: { variant: "default" },
});

export function AppToaster() {
  return (
    <Toast.Provider
      // 380 over HeroUI's 460: with the icon tile gone the text starts at the padding edge, so the
      // same sentence needs less width to hold its measure. Below `sm` the region's own rule takes
      // over at viewport width - 2rem.
      width={380}
      gap={10}
      maxVisibleToasts={3}
      placement="bottom">
      {({ toast: queued }) => {
        const { actionProps, description, indicator, isLoading, title, variant = "default" } = queued.content;
        const styles = toastCard({ variant });

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
            {/* The ONLY thing left in the indicator slot is a spinner, and only while one is warranted:
                a pending toast has to show that something is still running, which no border can say.
                `indicator === null` removes the slot entirely rather than rendering an empty box, so a
                settled toast's text starts at the padding edge. */}
            {(isLoading || indicator) && (
              <Toast.Indicator
                variant={variant}
                className="text-foreground-muted flex size-5 shrink-0 items-center justify-center p-0">
                {isLoading ? (
                  <Spinner
                    color="current"
                    size="sm"
                  />
                ) : (
                  indicator
                )}
              </Toast.Indicator>
            )}

            <Toast.Content className="flex min-w-0 flex-1 flex-col items-start gap-1">
              {!!title && <Toast.Title className="fluid-sm text-foreground font-semibold">{title}</Toast.Title>}
              {!!description && (
                <Toast.Description className="fluid-xs text-foreground-muted leading-normal font-medium opacity-100">
                  {description}
                </Toast.Description>
              )}
              {!!actionProps?.children && (
                <Toast.ActionButton
                  {...actionProps}
                  variant="primary"
                  // The site's affirmative treatment, at the compact end of the scale. A toast's one
                  // action is always the way out of what it reported, so it takes the brand fill —
                  // never a severity colour, which would read as "this button is the danger".
                  className="bg-brand-solid text-brand-solid-foreground fluid-xs data-hovered:bg-brand-solid-hover mt-1 h-8 rounded-lg px-3.5 font-semibold transition-colors">
                  {actionProps.children}
                </Toast.ActionButton>
              )}
            </Toast.Content>

            {/* `inset-auto` is load-bearing: HeroUI parks this control outside the shell's top-right
                corner, and the redesign brings it back into the row. Its visibility is NOT set here —
                see the `[data-frontmost]` note in `globals.css`. 28px is the smallest this may get:
                WCAG 2.5.8 puts the floor at 24. */}
            <Toast.CloseButton
              aria-label="Benachrichtigung schließen"
              className="text-foreground-muted data-hovered:text-foreground data-hovered:bg-hover relative inset-auto size-7 shrink-0 rounded-md border-0 bg-transparent transition-colors"
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
