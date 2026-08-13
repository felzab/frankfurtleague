/**
 * SHARED · the one callout appearance
 *
 * A consequence stated inline, at the control that causes it. Three severities and nothing else — the
 * grades, and what must never be said at each, are on the export.
 */

import { CircleInfo, TriangleExclamation } from "@gravity-ui/icons";
import { tv } from "tailwind-variants";

import { CloseButton } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";

import type { ReactNode } from "react";

const callout = tv({
  slots: {
    root: "flex w-full flex-row items-start gap-x-3 rounded-xl border p-3",
    icon: "mt-0.5 size-5 shrink-0",
    title: "fluid-xs font-bold",
    body: "fluid-xxs text-foreground leading-normal font-medium",
  },
  variants: {
    severity: {
      info: { root: "border-info/40 bg-info/15", icon: "text-info-strong", title: "text-info-strong" },
      warning: { root: "border-warning/40 bg-warning/15", icon: "text-warning-strong", title: "text-warning-strong" },
      danger: { root: "border-danger/40 bg-danger/15", icon: "text-danger-strong", title: "text-danger-strong" },
    },
  },
  defaultVariants: { severity: "warning" },
});

const ICONS = {
  info: CircleInfo,
  warning: TriangleExclamation,
  danger: TriangleExclamation,
} as const;

/**
 * A consequence the admin should know before they cause it, or a standing fact about what they are
 * looking at.
 *
 * **The colour grades follow the app's rule and nothing here reaches for `-solid`.** The fill is the
 * plain accent at `/15`, the title and the icon are its `-strong` companion — that is the pairing the
 * accent tokens in `globals.css` were measured against, and `text-warning` on its own `/15` tint
 * measures 1.61:1. The body stays `text-foreground`, because a paragraph is not a label.
 *
 * **What each grade means, so the three do not collapse into one:**
 *
 * - `info` — a standing property of the thing on screen. Nothing the admin did, nothing to undo.
 * - `warning` — something a save may destroy. It has to name what, or it is decoration.
 * - `danger` — a consequence of the edit just made that no later edit reverses on its own.
 *
 * **`isAnnounced` is off by default and that is deliberate.** A callout present from first paint is a
 * property of the fixture, and `role="alert"` would have a screen reader announce it as an event on
 * every render. Turn it on only where the callout appears *because* the admin just did something,
 * which is the one case an interruption is honest.
 *
 * Two glyphs for three grades: `info` gets its own, and `warning` and `danger` share
 * `TriangleExclamation` because they differ in degree rather than in kind — the colour carries that,
 * and a third shape would imply a third category.
 */
export function Callout({
  severity = "warning",
  title,
  isAnnounced = false,
  onDismiss,
  children,
}: {
  severity?: "info" | "warning" | "danger";
  title: string;
  isAnnounced?: boolean;
  /**
   * Makes the callout dismissible. Omit it and there is no close control at all.
   *
   * **Only for a callout the admin can afford to lose.** A standing note explaining the surface is one;
   * a warning about what a save destroys is not, and it deliberately has no dismiss — hiding it would
   * make the page quieter by making it less true. The caller decides, because the caller knows which
   * of the two it is rendering.
   */
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const styles = callout({ severity });
  const Icon = ICONS[severity];

  return (
    <div
      role={isAnnounced ? "alert" : undefined}
      className={styles.root()}>
      <Icon className={styles.icon()} />
      <div className="flex min-w-0 flex-1 flex-col gap-y-1">
        <strong className={styles.title()}>{title}</strong>
        <p className={styles.body()}>{children}</p>
      </div>
      {onDismiss && (
        <CloseButton
          {...dismissControl({ label: `${title} ausblenden`, className: "-mt-0.5" })}
          onPress={onDismiss}
        />
      )}
    </div>
  );
}
