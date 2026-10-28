import { tv } from "tailwind-variants/lite";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

const column = tv({
  base: "mx-auto flex w-full flex-1 flex-col gap-6 px-4 py-8 lg:py-12",
  variants: {
    // A form or a mailed page in the form column, or one card centred on the page, as a status page stands.
    width: {
      form: "max-w-[47.5rem]",
      card: "max-w-[30rem] justify-center",
    },
  },
});

/**
 * A page inside the classic frame: its content in the plain column. The classic frame's layout places the
 * header and the footer around it; a template places this, which with `RailPage` writes every page's `main`.
 */
export function ClassicPage({ width, children }: { width: "form" | "card"; children: ReactNode }) {
  return <main className={column({ width })}>{children}</main>;
}

/** A classic page's one title, in Anton at 24 px: at the column's head, or in a status card. */
export function ClassicTitle({ text }: { text: Copy | string }) {
  return <h1 className="font-heading text-2xl tracking-[0.02em] uppercase">{text}</h1>;
}
