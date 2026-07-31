import { tv } from "tailwind-variants";

import type { ReactNode } from "react";

/**
 * The status-panel family — the full-page error and 404 screens and the dashboard's inline error
 * card. The three were near-identical markup pasted three times, and they drifted: one screen's
 * buttons had hover feedback while its sibling's had none, heights disagreed, panel opacity and
 * shadow disagreed (audit, 2026-07-31). The soccer-themed copy stays at each call site; the
 * chrome lives here once.
 *
 * `page` is the theatrical full-viewport treatment (watermark behind a blurred panel); `inline`
 * is the softer in-shell card for errors that only take down one dashboard region.
 */
const statusPanel = tv({
  slots: {
    root: "relative flex flex-col items-center justify-center text-center",
    watermark: "pointer-events-none mb-4 flex items-center justify-center select-none sm:absolute sm:inset-0 sm:mb-0",
    panel: "border-border relative z-10 flex w-full flex-col items-center rounded-2xl border",
    badge: "bg-background border-border mb-6 flex items-center gap-2.5 rounded-full border px-3 py-1.5 shadow-sm",
    dot: "h-2 w-2 animate-pulse rounded-full",
    badgeText: "text-foreground text-fluid-xxs sm:text-fluid-xs font-black tracking-widest uppercase",
    message: "text-foreground-muted leading-relaxed font-medium",
    digest: "text-foreground-muted/60 mt-4 font-mono text-xs tracking-wider",
  },
  variants: {
    variant: {
      page: {
        root: "bg-background min-h-[100dvh] overflow-hidden p-4 sm:p-6",
        panel: "bg-surface/70 max-w-2xl p-6 text-center shadow-2xl backdrop-blur-xl sm:rounded-3xl sm:p-12 md:p-16",
        badge: "sm:mb-8 sm:px-4",
        dot: "sm:h-2.5 sm:w-2.5",
        message: "text-fluid-base mt-4 max-w-md sm:mt-5",
      },
      inline: {
        root: "h-full min-h-[400px] w-full p-6",
        panel: "bg-surface/50 max-w-lg p-8 shadow-sm",
        message: "text-fluid-sm mt-3",
      },
    },
    tone: {
      danger: { dot: "bg-danger" },
      warning: { dot: "bg-warning" },
    },
  },
  defaultVariants: { variant: "page", tone: "danger" },
});

export function StatusPanel({
  variant = "page",
  tone = "danger",
  watermark,
  badgeLabel,
  heading,
  message,
  digestLabel,
  digest,
  children,
}: {
  variant?: "page" | "inline";
  tone?: "danger" | "warning";
  /** The oversized glyph behind the page variant ("ERROR", "404"). Sized by the caller. */
  watermark?: ReactNode;
  badgeLabel: string;
  /** Rendered as h1 on `page` (the route's only content) and h2 on `inline` (the shell has the h1). */
  heading: ReactNode;
  message: string;
  digestLabel?: string;
  digest?: string;
  /** The action row — `ctaButton()`-styled links/buttons supplied by the caller. */
  children: ReactNode;
}) {
  const styles = statusPanel({ variant, tone });
  const Heading = variant === "page" ? "h1" : "h2";

  return (
    <div className={styles.root()}>
      {watermark && <div className={styles.watermark()}>{watermark}</div>}

      <div className={styles.panel()}>
        <div className={styles.badge()}>
          <div className={styles.dot()} />
          <span className={styles.badgeText()}>{badgeLabel}</span>
        </div>

        <Heading className={`${variant === "page" ? "text-fluid-2xl" : "text-fluid-lg"} text-foreground font-extrabold tracking-tight`}>
          {heading}
        </Heading>

        <p className={styles.message()}>{message}</p>

        {digest && (
          <p className={styles.digest()}>
            {digestLabel ?? "Fehler-Code"}: {digest}
          </p>
        )}

        {children}
      </div>
    </div>
  );
}
