import Link from "next/link";

import { tv } from "tailwind-variants";

import { ctaButton } from "@/shared/components/ui/formButtons";

/**
 * The app's "nothing here" language, so a view with an empty collection never renders a blank region. `tone="positive"`
 * is the one justified deviation, declared rather than accidental: on the triage view an empty category is good news.
 */
const emptyState = tv({
  slots: {
    // `max-w-page` on the panel rather than on each caller's wrapper: a view centring it in an
    // uncapped flex row otherwise gets a panel spanning the whole content area on a wide screen.
    root: "flex w-full max-w-page flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-surface p-10 text-center shadow-sm",
    title: "fluid-base font-bold",
    hint: "muted-hint",
  },
  variants: {
    tone: {
      neutral: { title: "text-foreground" },
      positive: { title: "text-success-strong" },
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
  aktion,
  tone,
  className,
}: {
  title: string;
  hint?: string;
  /** The way out of the empty state where it has one, inside the panel as `BewerbungView`'s state panels carry theirs. */
  aktion?: { href: string; label: string };
  tone?: "neutral" | "positive";
  className?: string;
}) {
  const styles = emptyState({ tone });

  return (
    <div className={styles.root({ className })}>
      <p className={styles.title()}>{title}</p>
      {hint && <p className={styles.hint()}>{hint}</p>}
      {aktion !== undefined && (
        <Link
          href={aktion.href}
          prefetch={false}
          className={`${ctaButton({ intent: "primary", size: "sm", hover: "css" })} mt-2 w-full sm:w-56`}>
          {aktion.label}
        </Link>
      )}
    </div>
  );
}
