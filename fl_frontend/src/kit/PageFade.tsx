import { Suspense, ViewTransition } from "react";

import type { ReactNode } from "react";

/**
 * A part of the page that fades in as it arrives and out as it leaves, through React's `ViewTransition`: a
 * navigation, which Next runs as a transition, brings one page's and takes the other's, and a wait's end brings
 * the content and takes the skeleton. `tokens.css` gives every view transition its duration and keeps it to
 * opacity. `default="none"` turns off every other trigger, so a change inside the part, such as a save's answer,
 * stays still. React starts the fade only where no DOM element of the arriving or leaving subtree stands above
 * it, which is why it stands first in `RailPage` and in `ClassicPage`, so a boundary whose skeleton and content
 * are each a whole page fades with no more than that.
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

/**
 * A template's one loading boundary where it stands inside the page, under the title: its fallback while the
 * content is read, the skeleton of the content's box where it draws one, fading out as the content fades in.
 * Never around a whole page, whose own fade would then stand directly inside this one: the server's streamed
 * reveal reads the innermost and would leave the swap without a fade.
 */
export function PageWait({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  return (
    <Suspense fallback={<PageFade>{fallback}</PageFade>}>
      <PageFade>{children}</PageFade>
    </Suspense>
  );
}
