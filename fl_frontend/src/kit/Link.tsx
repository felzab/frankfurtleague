import NextLink from "next/link";

import { buttonLook } from "./buttonStyles";
import { Icon } from "./Icon";
import { IconLink } from "./IconLink";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { IconName } from "./Icon";

const link = tv({
  variants: {
    // Underlined inside running text alone; a link standing on its own is known by its place. A row's
    // link is its record's name, stretched over the row it stands in, so the whole row opens the record.
    // A card's link is the whole card, filling under the pointer as a row does.
    placement: {
      text: "text-brand underline",
      standalone: "text-brand",
      // A line of detail that leads on, such as a team's place under its name: muted until the pointer is over it.
      detail: "text-fg-muted transition-colors duration-(--motion-state) hover:text-fg",
      // A row's name takes its row's colour, muted in a row that no longer counts.
      row: "text-inherit after:absolute after:inset-0 after:content-['']",
      card: "block text-fg transition-colors duration-(--motion-state) hover:bg-bg-surface",
      // Drawn by `buttonLook` in the look the link names.
      button: "",
    },
  },
});

/**
 * A link the frames draw themselves, 36 px tall, coloured by the ground it stands on: the classic header's
 * on the dark-green band, the title strip's legal pages, „Anmelden“ at the rail's foot.
 */
export const frameLink = tv({
  base: "flex h-9 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap",
  variants: {
    tone: {
      // On the band: the page the visitor is on, and „Anmelden“, in full white.
      band: "text-on-brand",
      // On the band, every other page: the white dimmed until the pointer is over it.
      bandMuted: "text-on-brand/75 hover:text-on-brand",
      // The title strip's: muted until the pointer is over it.
      strip: "text-fg-muted hover:text-fg",
      // The rail's foot: filled under the pointer as the rail's entries are.
      rail: "text-fg hover:bg-bg-muted",
    },
  },
});

/**
 * An entry of a list a frame opens, its glyph before its words where it has one: a menu's, 36 px on desktop,
 * and a sheet's, 44 px on a phone.
 */
export const menuEntry = tv({
  base: "flex items-center gap-3 rounded-md px-3 font-medium text-fg",
  variants: {
    size: {
      desktop: "h-9 text-sm",
      phone: "h-11 text-base",
    },
  },
});

// The focus file's mark for each placement: a ring hugging the words, a ring with its gap, a ring drawn
// inside the row the link covers, or one inside the card, which a list's card would otherwise clip; a link
// drawn as a button rings as a button does.
const FOCUS = { text: "text", standalone: "ring", detail: "ring", row: "row", card: "inset", button: "ring" } as const;

type Words =
  | { /** Catalogue words. */ label: Copy; text?: never; children?: never }
  | { /** A record's own name, such as a club's or a venue's: data, not catalogue text. */ text: string; label?: never; children?: never };

/**
 * A link drawn as a button: `primary` for a page's one next step, such as a status card's way on;
 * `secondary` for a way on beside it, or one standing where the page has no single next step. Its words may
 * lead with a glyph.
 */
type Button = { placement: "button"; look: "primary" | "secondary"; leadingIcon?: IconName } & Words;

/**
 * A glyph alone, in the icon-only button's look: `label`, at most five words, is its name, which the kit's
 * tooltip shows above it.
 */
type IconOnly = { placement: "icon"; icon: IconName; label: Copy; text?: never; children?: never; fullPage?: never };

/**
 * A row's link, its record's name stretched over the row it stands in, which `Table` and `LinkRows` write. Its
 * content may be markup, the link's accessible name as a card's is: a table row's club, its plaque with the
 * name a phone hides visually, so the stretched link keeps the full name where only the plaque shows.
 */
type Row = { placement: "row" } & (Words | { children: ReactNode; label?: never; text?: never });

type Card = {
  placement: "card";
  /**
   * The card's content, which is the link's accessible name, so it is read as one line. Only `SpielRow`,
   * `BracketCard` and `Card` place a card link, and nothing interactive stands inside one: no button, link
   * or menu, which a link may not contain.
   */
  children: ReactNode;
  label?: never;
  text?: never;
};

/**
 * The one way to go somewhere: Next's link, prefetching on hover and in view, so a page of links loads
 * no React Aria. Its ring comes from `:focus-visible` in the focus file, hugging the words inside text.
 */
export function Link<T extends string>(
  props: {
    href: Route<T>;
    /** Opens the target in a new tab; nothing else does. */
    newTab?: boolean;
    /**
     * Loads the target as a whole document, the plain anchor's navigation, rather than Next's client one. An
     * intercepting route catches every client navigation to its address, so this is the one way from a pop-up
     * to the page it stands for: Next shows that page, not the pop-up, on a full page load.
     */
    fullPage?: boolean;
  } & (({ placement: "text" | "standalone" | "detail" } & Words) | Row | Button | IconOnly | Card),
) {
  const { href, newTab = false, fullPage = false } = props;
  const tab = { target: newTab ? "_blank" : undefined, rel: newTab ? "noopener noreferrer" : undefined };
  if (props.placement === "icon") {
    return (
      <IconLink
        href={href}
        icon={props.icon}
        label={props.label}
        className={buttonLook({ look: "icon", host: "link" })}
        {...tab}
      />
    );
  }
  const button = props.placement === "button" ? props : undefined;
  const anchor = {
    href,
    "data-kit-focus": FOCUS[props.placement],
    className: button === undefined ? link({ placement: props.placement }) : buttonLook({ look: button.look, host: "link" }),
    ...tab,
  };
  const words = (
    <>
      {button?.leadingIcon !== undefined && (
        <Icon
          glyph={button.leadingIcon}
          size={16}
        />
      )}
      {props.children ?? props.label ?? props.text}
    </>
  );
  return fullPage ? <a {...anchor}>{words}</a> : <NextLink {...anchor}>{words}</NextLink>;
}
