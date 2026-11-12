import NextLink from "next/link";

import { textOf } from "@/core/copy";

import { buttonLook } from "./buttonStyles";
import { cardHover } from "./cardStyles";
import { hoverLook } from "./hoverStyles";
import { Icon } from "./Icon";
import { IconLink } from "./IconLink";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { IconName } from "./Icon";

const link = tv({
  variants: {
    // Underlined inside running text alone; a link standing on its own is known by its place. A row's
    // link is its record's name, stretched over the row it stands in, so the whole row opens the record.
    // A card's link is the whole card, filling under the pointer as a row does.
    placement: {
      // Under the pointer every link of words takes an underline and its full colour, as a link answers, and one
      // underlined already in text thickens its line. A link drawn as a row, a card or a button takes their layer.
      text: `text-brand underline ${hoverLook({ host: "link", answer: "line" })}`,
      standalone: `text-brand ${hoverLook({ host: "link", answer: "underline" })}`,
      // A line of detail that leads on, such as a team's place under its name: muted until the pointer is over it.
      detail: `text-fg-muted transition-colors duration-(--motion-state) ${hoverLook({ host: "link", answer: "fullUnderline" })}`,
      // A row's name takes its row's colour, muted in a row that no longer counts.
      row: "text-inherit after:absolute after:inset-0 after:content-['']",
      card: `block text-fg ${cardHover()}`,
      // The classic footer's links, its words and its sponsors' logos: muted until the pointer is over them.
      footer: `rounded-md text-sm leading-6 text-fg-muted transition-colors duration-(--motion-state) ${hoverLook({ host: "link", answer: "fullUnderline" })}`,
      // Drawn by `buttonLook` in the look the link names.
      button: "",
    },
    // A card standing as a row of a list's columns (`SpielList`): a grid of those columns rather than a block.
    subgrid: {
      true: "col-span-full grid grid-cols-subgrid",
      false: "",
    },
  },
});

/**
 * A link the frames draw themselves, as tall as every control, 32 px under a mouse and 40 px under a finger,
 * coloured by the ground it stands on: the classic header's on the dark-green band, the title strip's legal
 * pages, „Konto“ at a signed-out rail's foot.
 */
export const frameLink = tv({
  base: "flex h-8 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-state) pointer-coarse:h-10",
  variants: {
    // Under the pointer a link of words takes an underline and its full colour, the one in full white already too, so
    // every link of the band and the strip answers the pointer; the rail's foot is an entry, filled as the rail's are.
    tone: {
      // On the band: the page the visitor is on, and „Konto“, in full white.
      band: `text-on-brand ${hoverLook({ host: "link", answer: "underline" })}`,
      // On the band, every other page: the white dimmed until the pointer is over it.
      bandMuted: `text-on-brand/75 ${hoverLook({ host: "link", answer: "bandUnderline" })}`,
      // The title strip's: muted until the pointer is over it.
      strip: `text-fg-muted ${hoverLook({ host: "link", answer: "fullUnderline" })}`,
      // The rail's foot: filled under the pointer as the rail's entries are.
      rail: `text-fg ${hoverLook({ host: "link" })}`,
    },
  },
});

/**
 * An entry of a list a frame opens, its glyph before its words where it has one: a menu's, 32 px on desktop,
 * and a sheet's, 40 px on a phone, as tall as every control.
 */
export const menuEntry = tv({
  base: "flex items-center gap-3 rounded-md px-3 font-medium text-fg",
  variants: {
    size: {
      desktop: "h-8 text-sm",
      phone: "h-10 text-base",
    },
  },
});

// The focus file's mark for each placement: a ring hugging the words, a ring with its gap, a ring drawn
// inside the row the link covers, or one inside the card, which a list's card would otherwise clip; a link
// drawn as a button rings as a button does. The footer's words hug their ring as text does.
const FOCUS = { text: "text", standalone: "ring", detail: "ring", row: "row", card: "inset", footer: "text", button: "ring" } as const;

/** The link's words: the catalogue's, or a record's own name, such as a club's or a venue's. */
type Worded = { label: Words; children?: never };

/**
 * A link drawn as a button: `primary` for a page's one next step, such as a status card's way on;
 * `secondary` for a way on beside it, or one standing where the page has no single next step; `quiet` for the
 * lesser way on beneath a primary one, as the button's quiet act is. Its words may lead with a glyph.
 */
type Button = { placement: "button"; look: "primary" | "secondary" | "quiet"; leadingIcon?: IconName } & Worded;

/**
 * A glyph alone, in the icon-only button's look: `label`, at most five words, is its name, which the kit's
 * tooltip shows above it.
 */
type IconOnly = { placement: "icon"; icon: IconName; label: Copy; children?: never; fullPage?: never; prefetch?: never };

/**
 * A row's link, its record's name stretched over the row it stands in. Its
 * content may be markup, the link's accessible name as a card's is: a table row's club, its plaque with the
 * name a phone hides visually, so the stretched link keeps the full name where only the plaque shows.
 */
type Row = { placement: "row" } & (Worded | { children: ReactNode; label?: never });

/** A link of the classic footer: its words, or a sponsor's logo with its short name. */
type Footer = { placement: "footer" } & (Worded | { children: ReactNode; label?: never });

type Card = {
  placement: "card";
  /**
   * The card's content, which is the link's accessible name, so it is read as one line. Nothing interactive
   * stands inside one: no button, link or menu, which a link may not contain.
   */
  children: ReactNode;
  label?: never;
  /** A row of a list whose columns run through it, as `SpielList`'s do: the card takes the list's columns. */
  subgrid?: true;
};

/**
 * Another site's address: it opens in a new tab, leaving the site's page in place, and a site path or a mail
 * address never does. Decided from the address, so no caller has a flag to forget.
 */
const ELSEWHERE = /^https?:\/\//;

/**
 * The one way to go somewhere: Next's link, prefetching on hover and in view. The icon placement alone names its glyph
 * by React Aria's tooltip (`IconLink`), which every route loads with this module. Its ring comes from `:focus-visible`
 * in the focus file, hugging the words inside text.
 */
export function Link<T extends string>(
  props: {
    href: Route<T>;
    /** A sponsor's site: the link is marked paid, `rel="sponsored"`, for the search engines that follow it. */
    sponsored?: boolean;
    /**
     * Loads the target as a whole document, the plain anchor's navigation, rather than Next's client one. An
     * intercepting route catches every client navigation to its address, so this is the one way from a pop-up
     * to the page it stands for: Next shows that page, not the pop-up, on a full page load.
     */
    fullPage?: boolean;
    /**
     * Next's own `prefetch`. Unset, the target's shell. `false` for a link of a page of many, which prefetches nothing, in
     * view or under the pointer, as Next's guide to prefetching says of a large list: with `optimisticRouting` off, each
     * address in view costs a request of its own. `true` for the one likely next page whose content is cached reads every
     * visitor shares, which then arrives whole, at a server render per link in view.
     */
    prefetch?: boolean;
  } & (({ placement: "text" | "standalone" | "detail" } & Worded) | Row | Footer | Button | IconOnly | Card),
) {
  const { href, sponsored = false, fullPage = false, prefetch } = props;
  const elsewhere = ELSEWHERE.test(href);
  const rel = [sponsored ? "sponsored" : "", elsewhere ? "noopener noreferrer" : ""].filter((word) => word !== "").join(" ");
  const tab = { target: elsewhere ? "_blank" : undefined, rel: rel === "" ? undefined : rel };
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
    className:
      button === undefined
        ? link({ placement: props.placement, subgrid: props.placement === "card" && props.subgrid === true })
        : buttonLook({ look: button.look, host: "link" }),
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
      {props.children ?? (props.label === undefined ? null : textOf(props.label))}
    </>
  );
  return fullPage ? (
    <a {...anchor}>{words}</a>
  ) : (
    <NextLink
      {...anchor}
      prefetch={prefetch}>
      {words}
    </NextLink>
  );
}
