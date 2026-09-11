import { tv } from "tailwind-variants";

import { DISPLAY_HEADING } from "./displayType";

import type { ReactNode } from "react";

/**
 * The status-panel family: `page` is the display treatment, a watermark behind a blurred panel, and `inline` the softer
 * card for an error taking down one dashboard region. The copy stays at each call site; the chrome lives here.
 */
const statusPanel = tv({
  slots: {
    root: "relative flex flex-col items-center justify-center text-center",
    watermark: "pointer-events-none mb-4 flex items-center justify-center select-none sm:absolute sm:inset-0 sm:mb-0",
    panel: "border-border relative z-10 flex w-full flex-col items-center rounded-2xl border",
    badge: "bg-background border-border mb-6 flex items-center gap-2 rounded-full border px-3 py-1.5 shadow-sm",
    dot: "size-2 animate-pulse rounded-full",
    badgeText: "text-foreground fluid-xxs sm:fluid-xs font-extrabold tracking-widest uppercase",
    message: "text-foreground-muted leading-relaxed font-medium",
    digest: "text-foreground-muted fluid-xxs mt-4 font-mono tracking-wider",
  },
  variants: {
    variant: {
      page: {
        root: "bg-background overflow-hidden p-4 sm:p-6",
        panel: "bg-surface/70 max-w-2xl p-6 text-center shadow-2xl backdrop-blur-xl sm:rounded-3xl sm:p-12 md:p-16",
        badge: "sm:mb-8 sm:px-4",
        dot: "sm:h-2.5 sm:w-2.5",
        message: "fluid-base mt-4 max-w-md sm:mt-6",
      },
      inline: {
        root: "w-full p-6",
        panel: "bg-surface/50 max-w-lg p-8 shadow-sm",
        message: "fluid-sm mt-3",
      },
    },
    /**
     * Which box the panel is asked to fill. `page` grounds on `document`, so a panel moved under a
     * shell keeps a ground that is a navbar too tall until this is passed with it.
     */
    fills: {
      document: { root: "min-h-[100dvh]" },
      /*
        The public shell's own floor: a taller box pushes the footer up onto the first screen, and
        `flex-1` is what covers a shell floor risen past this one. `w-full` because that shell
        centres its children (`fl_frontend/src/shared/components/layout/shell/PublicShell.tsx`).
      */
      shell: { root: "min-h-[calc(100dvh-var(--navbar-height)-1px)] w-full flex-1" },
      region: { root: "h-full min-h-[400px]" },
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
  fills,
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
  fills?: "document" | "shell" | "region";
  /** The oversized glyph behind the page variant ("ERROR", "404"). Sized by the caller. */
  watermark?: ReactNode;
  badgeLabel: string;
  /** Rendered as h1 on `page`, which carries the route's only one, and h2 on `inline` (the shell has the h1). */
  heading: ReactNode;
  message: string;
  digestLabel?: string;
  digest?: string;
  /** The action row — `ctaButton()`-styled links/buttons supplied by the caller. */
  children: ReactNode;
}) {
  const styles = statusPanel({ variant, tone, fills: fills ?? (variant === "page" ? "document" : "region") });
  const Heading = variant === "page" ? "h1" : "h2";

  return (
    <div className={styles.root()}>
      {watermark && (
        <div
          aria-hidden="true"
          className={styles.watermark()}>
          {watermark}
        </div>
      )}

      <div className={styles.panel()}>
        <div className={styles.badge()}>
          <div className={styles.dot()} />
          <span className={styles.badgeText()}>{badgeLabel}</span>
        </div>

        {/* Two strings rather than one with the step swapped: the page variant's fixed copy is the
            display voice, and the inline variant sits below `fluid-xl`, where that voice starts. */}
        <Heading
          className={
            variant === "page" ? `${DISPLAY_HEADING} fluid-2xl text-foreground` : "fluid-lg text-foreground font-extrabold tracking-tight"
          }>
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
