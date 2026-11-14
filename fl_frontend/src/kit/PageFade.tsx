import { ViewTransition } from "react";

import type { ReactNode } from "react";

/**
 * A page that fades in as it arrives and out as it leaves, through React's `ViewTransition`: a navigation, which Next
 * runs as a transition, brings one page and takes the other. `tokens.css` gives every view transition its duration
 * and keeps it to opacity. `default="none"` turns off every other trigger, so a change inside the page, such as a save's
 * answer, stays still. React starts the fade only where no DOM element of the arriving or leaving subtree stands above
 * it, which is why no element of `RailPage` or `ClassicPage` holds it: the fade runs once, from the page a navigation
 * leaves to the finished page it brings. It writes a name of its own on each element at its top, over any name a
 * stylesheet gives that element, so a part that must keep its own name, as the title strip and the editor's bar do,
 * stands beside it.
 */
export function PageFade({ children }: { children: ReactNode }) {
  return (
    <ViewTransition
      default="none"
      enter="auto"
      exit="auto">
      {children}
    </ViewTransition>
  );
}
