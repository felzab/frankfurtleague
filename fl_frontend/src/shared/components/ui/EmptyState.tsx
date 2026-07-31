import { tv } from "tailwind-variants";

/**
 * The app's "nothing here" language. Eight views rendered a blank region when their collection was
 * empty — `/dashboard/playoffs` most visibly, where an explicit `return null` produced a completely
 * empty content area for most of a season (R4 §12.2). The six that did say something used four
 * different visual treatments (R4 §12.3).
 *
 * `tone="positive"` is the one justified deviation, preserved as a declared variant rather than an
 * accident: in the admin action-required view an empty category genuinely is good news.
 */
const emptyState = tv({
  slots: {
    root: "border-border bg-surface flex w-full flex-col items-center justify-center gap-2 rounded-2xl border p-10 text-center shadow-sm",
    title: "text-fluid-base font-bold",
    hint: "text-fluid-sm text-foreground-muted font-medium",
  },
  variants: {
    tone: {
      neutral: { title: "text-foreground" },
      positive: { title: "text-success" },
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function EmptyState({ title, hint, tone }: { title: string; hint?: string; tone?: "neutral" | "positive" }) {
  const styles = emptyState({ tone });

  return (
    <div className={styles.root()}>
      <p className={styles.title()}>{title}</p>
      {hint && <p className={styles.hint()}>{hint}</p>}
    </div>
  );
}
