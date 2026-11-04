import { KONTAKT_EMAIL } from "@/core/brand";

import type { ReactNode } from "react";

// Its own module, importing no hook: the account page, a Server Component, reads it, and a module
// holding a hook cannot sit in its import graph.

/** The values the link pages and the account page name alike: the league's address and the erasure control's own name. */
export const FESTE_WERTE = { kontakt: KONTAKT_EMAIL, loeschung: "Konto löschen" } as const;

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
