import type { ReactNode } from "react";

/**
 * The one body step of the link pages' own sentences: these are words a reader has to get through, so
 * they take the paragraph grade rather than a caption's meta grade.
 */
export const ABSATZ_CLASSES = "max-w-2xl fluid-sm leading-relaxed font-medium text-pretty text-foreground";

/**
 * The one emphasis a reader's own value wears here: a second spelling is how the name in one
 * sentence stops matching the name in the next. `fl_frontend/src/core/emailShell.ts :: strong` is
 * the mail's end of the same rule.
 */
export function Wert({ children }: { children: ReactNode }) {
  return <strong className="font-bold text-foreground">{children}</strong>;
}
