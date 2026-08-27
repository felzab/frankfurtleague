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
 * **What each grade means, so the three stay distinct:** `info` is worth knowing, `warning` worth weighing before
 * acting, `danger` serious enough to read as an alarm. Loudness alone —
 * `railBanner.ts :: RailBanner`'s `raisedBy` decides what confirms.
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
  /**
   * Off by default: a callout present from first paint is a standing property, and `role="alert"` would have a screen
   * reader announce it as an event. On only where the callout appears *because* of an action.
   */
  isAnnounced?: boolean;
  /**
   * Dismissible, and only for a callout the admin can afford to lose: hiding a warning about what a save destroys makes
   * the page quieter by making it less true.
   */
  onDismiss?: () => void;
  /** Absent where the title carries the whole consequence: an empty paragraph would still take its gap. */
  children?: ReactNode;
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
        {children !== undefined && <p className={styles.body()}>{children}</p>}
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
