"use client";

import { tv } from "tailwind-variants";

import { Spinner, Toast } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";

/**
 * Severity is two thin marks and no icon: the border and the draining bar already say it, and the
 * tile cost a third of the toast's width. The CSS surface is the toast rules in `globals.css`.
 */
const toastCard = tv({
  slots: {
    /** `origin-left` is what makes the scaleX read as draining. */
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
      // Under HeroUI's default: with no icon tile the text starts at the padding edge, so the same
      // sentence holds its measure in less width.
      width={380}
      gap={10}
      maxVisibleToasts={3}
      placement="bottom">
      {({ toast: queued }) => {
        const { actionProps, description, indicator, isLoading, title, variant = "default" } = queued.content;
        const styles = toastCard({ variant });

        // Only a self-closing toast gets a bar. A pending one is closed by its own key
        // (`appToast.pending`), so a bar there would promise a deadline nothing counts down.
        const timeout = queued.timeout;
        const hasTimer = !isLoading && typeof timeout === "number" && timeout > 0;

        return (
          <Toast
            toast={queued}
            variant={variant}
            placement="bottom">
            {/* Rendered conditionally rather than with `indicator === null`, so a settled toast has no
                empty box and its text starts at the padding edge. */}
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
                // Spelled out rather than `muted-meta`: this wants the recipe without its line-height,
                // and a utility plus a `leading-*` undoing part of it would rest on emission order.
                <Toast.Description className="fluid-xs text-foreground-muted leading-normal font-medium opacity-100">
                  {description}
                </Toast.Description>
              )}
              {!!actionProps?.children && (
                <Toast.ActionButton
                  {...actionProps}
                  variant="primary"
                  // A toast's one action is the way out of what it reported, so it takes the brand
                  // fill -- never a severity colour, which reads as "this button is the danger".
                  className="bg-brand-solid text-brand-solid-foreground fluid-xs data-hovered:bg-brand-solid-hover mt-1 h-8 rounded-lg px-3.5 font-semibold transition-colors">
                  {actionProps.children}
                </Toast.ActionButton>
              )}
            </Toast.Content>

            {/* `inset-auto` is load-bearing: HeroUI parks this control outside the shell's corner.
                Its visibility is not set here — see the `[data-frontmost]` note in `globals.css`. */}
            <Toast.CloseButton {...dismissControl({ label: "Benachrichtigung schließen", className: "relative inset-auto" })} />

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
