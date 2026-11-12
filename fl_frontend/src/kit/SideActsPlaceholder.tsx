import { buttonLook, buttonPlaceholder } from "./buttonStyles";

import type { Copy } from "@/core/copy";

/** The „⋯“'s bar, the size of `SideActs`' button, a glyph's alone. */
const MORE_BAR_CLASSES = "w-8 px-0 @2xl:hidden pointer-coarse:w-10";

/**
 * A row's side acts while the rows are read, in both forms `SideActs` picks between by the list's box: the button of
 * the act every row carries in a box of 42 rem or more, and the „⋯“'s bar in a narrower one. Apart from `SideActs`,
 * a client module, so a list drawn on the server draws its wait without it.
 */
export function SideActsPlaceholder({ act }: { act: Copy }) {
  return (
    <>
      <span className={buttonPlaceholder("@max-2xl:hidden")}>{act}</span>
      <span className={buttonLook({ look: "placeholder", class: MORE_BAR_CLASSES })} />
    </>
  );
}
