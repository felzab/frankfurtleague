import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

const page = tv({
  slots: {
    // At least the first screen under the classic header, whose height the frame declares, so on every page
    // the footer starts just below the screen and is reached by scrolling. The gutter stands here, outside
    // the column, so the column's width is its content's.
    main: "flex min-h-[calc(100dvh-var(--classic-header))] w-full flex-1 flex-col px-4 py-8 lg:py-12",
    column: "mx-auto flex w-full flex-1 flex-col gap-6",
  },
  variants: {
    // A form or a mailed page in the form column, one card centred on the page as a status page stands, the
    // sign-in's column, which proportions its full-width controls as Vercel's sign-in does, or the landing,
    // as wide as the header's and the footer's row, its sections farther apart than a form's.
    width: {
      form: { column: "max-w-form" },
      card: { column: "max-w-card justify-center" },
      signin: { column: "max-w-signin justify-center" },
      // Board: the gap between the landing's sections, 48 px on a phone and 64 px from `lg`.
      landing: { column: "max-w-classic gap-12 lg:gap-16" },
    },
  },
});

/**
 * A page inside the classic frame: its content in the plain column, filling the first screen. The classic
 * frame's layout places the header and the footer around it; a template places this, which with `RailPage`
 * writes every page's `main`.
 */
export function ClassicPage({ width, children }: { width: "form" | "card" | "signin" | "landing"; children: ReactNode }) {
  const { main, column } = page({ width });
  return (
    <main className={main()}>
      <div className={column()}>{children}</div>
    </main>
  );
}

/** A classic page's one title, in Anton at 24 px: at the column's head, or in a status card. */
export function ClassicTitle({ text }: { text: Copy }) {
  return <h1 className="font-heading text-2xl tracking-display uppercase">{text}</h1>;
}
