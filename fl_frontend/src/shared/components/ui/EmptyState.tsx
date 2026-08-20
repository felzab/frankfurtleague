import { tv } from "tailwind-variants";

/**
 * The app's "nothing here" language, so a view with an empty collection never renders a blank region. `tone="positive"`
 * is the one justified deviation, declared rather than accidental: on the triage view an empty category is good news.
 */
const emptyState = tv({
  slots: {
    root: "border-border bg-surface flex w-full flex-col items-center justify-center gap-2 rounded-2xl border p-10 text-center shadow-sm",
    title: "fluid-base font-bold",
    hint: "muted-hint",
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
 * `className` reaches the panel itself rather than a wrapper, for one job: letting a caller give it a `min-h-*` so an
 * empty section still reserves its height. A wrapper cannot, the panel not stretching to fill one.
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
