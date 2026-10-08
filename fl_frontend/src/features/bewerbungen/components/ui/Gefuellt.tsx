import { Fragment } from "react";
import Link from "next/link";

import { KONTAKT_EMAIL } from "@/core/brand";
import { textLink } from "@/shared/components/ui/textLink";
import { DATENSCHUTZ_SLOT, stueckeVon } from "@/shared/utils/stampedSlots";

import type { Slots, Stueck } from "@/shared/utils/stampedSlots";
import type { ReactNode } from "react";

// Its own module, importing no hook: the account page, a Server Component, sets the stamped words
// the confirmation pages set, and a module holding a hook cannot sit in its import graph.

/**
 * The slots every page setting stamped words fills alike: the league's address and the erasure
 * control's own name. Never `{minAlter}`, which the contact page's seats answer differently.
 */
export const FESTE_WERTE = { kontakt: KONTAKT_EMAIL, loeschung: "Konto löschen" } as const;

/**
 * The one body step, stamped text and the page's own sentences alike: these are legal words a
 * reader has to get through, so they take the paragraph grade rather than a caption's meta grade.
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

/** One filled piece in whatever its kind earns: the privacy link, a reader's own value, or the words as they stand. */
function stueckInhalt({ worte, slot }: Stueck, eigene: ReadonlySet<string>): ReactNode {
  if (slot === DATENSCHUTZ_SLOT) {
    return (
      <Link
        href="/datenschutz"
        prefetch={false}
        className={textLink()}>
        {worte}
      </Link>
    );
  }

  // Emphasis is presentation, so each page decides it here rather than in the stored sentence,
  // whose words and digest do not move for it.
  return slot !== undefined && eigene.has(slot) ? <Wert>{worte}</Wert> : worte;
}

/**
 * A stamped sentence with its slots filled as elements rather than into one string: a string cannot
 * carry the mark a reader's own name has to wear, nor the privacy link.
 */
export function Gefuellt({ text, werte, eigene }: { text: string; werte: Slots; eigene: ReadonlySet<string> }) {
  return (
    <>
      {stueckeVon(text, werte).map((stueck, index) => (
        <Fragment key={`${String(index)}-${stueck.worte}`}>{stueckInhalt(stueck, eigene)}</Fragment>
      ))}
    </>
  );
}
