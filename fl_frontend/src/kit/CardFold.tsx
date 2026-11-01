"use client";

import { useState } from "react";

import { Button, Disclosure, DisclosurePanel, Heading } from "react-aria-components/Disclosure";

import { card } from "./cardStyles";
import { Icon } from "./Icon";
import { useDesktop } from "./useDesktop";

import type { ReactElement, ReactNode } from "react";

/**
 * When a folded card starts folded: on every screen, or on a phone alone, where its body would push the rest
 * of the page down, and open from `lg`.
 */
export type Folded = "always" | "phone";

/**
 * `Card`'s folded form: its head is the one button that opens and closes its body, the kit's one disclosure.
 * React Aria's disclosure, a heading holding the button that names the panel it controls (the WAI-ARIA
 * accordion pattern), so the card's title stays a heading a reader can jump to. It is not `<details>`,
 * because a heading inside `<summary>` is not exposed as a heading in every browser and reader. A folded
 * body stays in the document as `hidden="until-found"`, which a browser's find on the page opens.
 *
 * The server cannot see the screen, so a card folded on a phone alone is drawn folded until hydration and
 * opens then on a desktop: the other way round, every phone would show the body and then fold it.
 */
export function CardFold({
  folded,
  title,
  count,
  line,
  body,
  action,
  children,
}: {
  folded: Folded;
  title: string;
  count?: number;
  line?: string;
  body: "rows" | "fields";
  action?: ReactElement;
  children?: ReactNode;
}) {
  const desktop = useDesktop(false);
  // The visitor's own choice outlasts the screen's default, which follows the screen until they choose.
  const [chosen, setChosen] = useState<boolean>();
  const s = card({ body, fold: true });
  return (
    <Disclosure
      isExpanded={chosen ?? (folded === "phone" && desktop)}
      onExpandedChange={setChosen}
      className={s.root()}>
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
            <span className="min-w-0">{title}</span>
          </span>
          {count !== undefined && <span className={s.count()}>{count}</span>}
          {line !== undefined && <span className={s.line()}>{line}</span>}
        </Button>
      </Heading>
      <DisclosurePanel className={s.body()}>
        {children}
        {action !== undefined && <div className={s.foot()}>{action}</div>}
      </DisclosurePanel>
    </Disclosure>
  );
}
