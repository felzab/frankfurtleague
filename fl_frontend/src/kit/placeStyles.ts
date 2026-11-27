import { tv } from "./tv";

/**
 * The lists of ways that mark the place a person is on, each drawing the one mark by its own shape: the frame's
 * `menu`, its rail and the sheets listing its pages, the classic band's among them; the phone's bottom `bar`; a page's
 * `tabs`; the classic `band`; and a reading page's `contents`, whose place is a section of the page rather than a page.
 */
export type PlaceList = "menu" | "bar" | "tabs" | "band" | "contents";

/**
 * The `aria-current` a list's current entry carries: WAI-ARIA's `location` for the section of a page the reader is in,
 * `page` for every page of a set of links.
 */
export const PLACE_CURRENT = {
  menu: "page",
  bar: "page",
  tabs: "page",
  band: "page",
  contents: "location",
} as const satisfies Record<PlaceList, "page" | "location">;

// Each list's mark, drawn from the link's `aria-current`, which `NavigationLink` sets from the same `place` prop, so the
// place a screen reader hears marked is the one drawn marked. Tailwind writes an `aria-*` variant after the plain
// classes and after `hover:` and `active:`, so the mark's words keep their colour over an entry's own and its hover's.
const mark = tv({
  variants: {
    list: { menu: "", bar: "", tabs: "", band: "", contents: "" },
    // Where the mark is read from: the link's attribute, or, for „Mehr“, a button no attribute marks, its own state.
    current: { attribute: "", true: "", false: "" },
  },
  compoundVariants: [
    // A filled entry of a vertical list: the muted fill, its words in full, and at its start a 4-px pill in the link
    // green, inset clear of the fill's rounded corners, as Primer's NavList draws its current item's accent line. The
    // fill alone keeps under 3:1 on the list's ground; the pill keeps 4.5:1 on the fill and on the ground in both themes.
    {
      list: "menu",
      current: "attribute",
      class:
        "aria-[current=page]:relative aria-[current=page]:bg-bg-muted aria-[current=page]:text-fg aria-[current=page]:after:absolute aria-[current=page]:after:inset-y-1.5 aria-[current=page]:after:start-0 aria-[current=page]:after:rounded-full aria-[current=page]:after:border-s-4 aria-[current=page]:after:border-brand",
    },
    // A place of the bottom bar: the muted fill, its words in full, and along its top a 2-px line in the link green over
    // the bar's hairline, as a tab's line lies over its row's. The line keeps 4.5:1 on the fill and on the page above.
    {
      list: "bar",
      current: "attribute",
      class:
        "aria-[current=page]:relative aria-[current=page]:bg-bg-muted aria-[current=page]:text-fg aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:-top-px aria-[current=page]:after:border-t-2 aria-[current=page]:after:border-brand",
    },
    {
      list: "bar",
      current: true,
      class: "relative bg-bg-muted text-fg after:absolute after:inset-x-0 after:-top-px after:border-t-2 after:border-brand",
    },
    // A tab: its words in full, and along its foot a 2-px line in the link green over the row's hairline, as Primer's
    // UnderlineNav draws it. The line keeps 4.5:1 on the page and on a card in both themes.
    {
      list: "tabs",
      current: "attribute",
      class:
        "aria-[current=page]:relative aria-[current=page]:text-fg aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:bottom-0 aria-[current=page]:after:border-b-2 aria-[current=page]:after:border-brand",
    },
    // A link of the classic band: its white in full, and along its foot a 2-px line in the band's accent green, the pair
    // the token lint holds at 3:1 as the mark on the band.
    {
      list: "band",
      current: "attribute",
      class:
        "aria-[current=page]:relative aria-[current=page]:text-on-brand aria-[current=page]:after:absolute aria-[current=page]:after:inset-x-0 aria-[current=page]:after:bottom-0 aria-[current=page]:after:border-b-2 aria-[current=page]:after:border-brand-accent",
    },
    {
      list: "contents",
      current: "attribute",
      class: "aria-[current=location]:border-brand aria-[current=location]:font-medium aria-[current=location]:text-fg",
    },
  ],
});

/**
 * The one mark of the place a person is on, for every list of ways that marks one (`PlaceList`). A link takes it through
 * `NavigationLink`'s `place`, which sets its `aria-current` too; the bar's „Mehr“, a button lit while its sheet holds the
 * page, takes the bar's mark by its `current` state, since a button is no page to name current.
 */
export function placeMark(of: { list: PlaceList } | { list: "bar"; current: boolean }): string {
  return mark({ list: of.list, current: "current" in of ? of.current : "attribute" });
}
