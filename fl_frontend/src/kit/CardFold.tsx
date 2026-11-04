"use client";

import { Button, Disclosure, DisclosurePanel, Heading } from "react-aria-components/Disclosure";

import { textOf } from "@/core/copy";

import { card } from "./cardStyles";
import { Icon } from "./Icon";

import type { Words } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * `Card`'s folded form, its title and its count in the head: its head is the one button that opens and closes its body,
 * the kit's one disclosure.
 * React Aria's disclosure, a heading holding the button that names the panel it controls (the WAI-ARIA
 * accordion pattern), so the card's title stays a heading a reader can jump to. It is not `<details>`,
 * because a heading inside `<summary>` is not exposed as a heading in every browser and reader. A folded
 * body stays in the document as `hidden="until-found"`, which a browser's find on the page opens. It starts
 * folded on every screen, so the server's markup is its first frame everywhere. Its head carries no chip, which
 * stands in a plain card's head alone, and its body holds rows: a read page's folded tables.
 */
export function CardFold({ title, count, children }: { title: Words; count?: number; children: ReactNode }) {
  const s = card({ body: "rows", fold: true });
  return (
    <Disclosure className={s.root()}>
      <Heading level={2}>
        <Button
          slot="trigger"
          data-kit-focus="inset"
          className={s.head()}>
          <span className={s.title()}>
            <span className={s.chevron()}>
              <Icon
                glyph="forward"
                size={16}
              />
            </span>
            <span className="min-w-0">{textOf(title)}</span>
          </span>
          {count !== undefined && <span className={s.count()}>{count}</span>}
        </Button>
      </Heading>
      <DisclosurePanel className={s.body()}>{children}</DisclosurePanel>
    </Disclosure>
  );
}
