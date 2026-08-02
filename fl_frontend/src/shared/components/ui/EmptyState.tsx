import { tv } from "tailwind-variants";

/**
 * The app's "nothing here" language. Eight views rendered a blank region when their collection was
 * empty — `/dashboard/playoffs` most visibly, where an explicit `return null` produced a completely
 * empty content area for most of a season. The six that did say something used four
 * different visual treatments.
 *
 * `tone="positive"` is the one justified deviation, preserved as a declared variant rather than an
 * accident: in the admin action-required view an empty category genuinely is good news.
 */
const emptyState = tv({
  slots: {
    root: "border-border bg-surface flex w-full flex-col items-center justify-center gap-2 rounded-2xl border p-10 text-center shadow-sm",
    title: "fluid-base font-bold",
    hint: "fluid-sm text-foreground-muted font-medium",
  },
  variants: {
    tone: {
      neutral: { title: "text-foreground" },
      positive: { title: "text-success" },
    },
  },
  defaultVariants: { tone: "neutral" },
});

/**
 * `className` reaches the panel itself, not a wrapper. It exists for one job — letting a caller give
 * the panel a `min-h-*` so a section that has nothing to show still reserves the height it would have
 * had — and a wrapper cannot do that, because the panel does not stretch to fill one.
 */
export function EmptyState({
  title,
  hint,
  tone,
  className,
}: {
  title: string;
  hint?: string;
  tone?: "neutral" | "positive";
  className?: string;
}) {
  const styles = emptyState({ tone });

  return (
    <div className={styles.root({ className })}>
      <p className={styles.title()}>{title}</p>
      {hint && <p className={styles.hint()}>{hint}</p>}
    </div>
  );
}
