import { SkipToContentLink } from "../../ui/SkipToContentLink";
import { Footer } from "../footer/Footer";
import { TopNav } from "../topnav/TopNav";

import type React from "react";

// `serverStatusSlot` is a prop rather than an import: `shared` may not import `features`
// (`docs/frontend/spec.md :: I9`), so every renderer of this shell injects it.
export function PublicShell({ serverStatusSlot, children }: { serverStatusSlot: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <SkipToContentLink isTargetInert={false} />

      {/* `box-content` is load-bearing: the height becomes --navbar-height plus the border, which
          the <nav> inside also uses. Under border-box the nav overflows it by the border. */}
      <header className="z-10 box-content h-(--navbar-height) w-full border-b border-border bg-surface">
        <TopNav />
      </header>

      {/* The floor keeps the footer off the first screen, where `flex-1` alone would park it at the
          bottom of one. Less the border `box-content` puts outside the token, which the floor
          would otherwise overshoot the screen by. */}
      <main
        id="main-content"
        className="flex min-h-[calc(100dvh-var(--navbar-height)-1px)] w-full flex-1 flex-col items-center justify-start">
        {children}
      </main>

      {/* A floor, never a height: a fixed one is left behind by a column gaining a link, and the
          fill stops where the separator and the copyright row are still being drawn. */}
      {/* The page's one contentinfo landmark, so `Footer` inside it renders a plain box: a second
          `<footer>` nested here is invalid and announces the footer twice. */}
      <footer className="z-10 flex w-full shrink-0 flex-col border-t border-border bg-surface lg:min-h-[220px]">
        <Footer serverStatusSlot={serverStatusSlot} />
      </footer>
    </>
  );
}
