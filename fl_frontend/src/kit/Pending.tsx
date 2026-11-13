import type { ReactNode } from "react";

/**
 * A block while its content is read: the block itself, drawn from a sample. What the page knows before the read stands
 * real in it, a title, a column's head, a label, a glyph, a control, so a wait shows a reader all it can, and only what
 * the read brings shows as a bar. The block says which is which: it marks each part the read brings, and the pending
 * rules (`tokens.css`) draw the marked parts and touch nothing else.
 *
 * - `data-kit-bar` on a part that is one bar of its own box, as `TeamPlaque` and `Chip` carry it.
 * - `data-kit-bar="words"` on an inline `span` around a value's words, whose bar is as wide as each line of them. The
 *   `span` is the words' own: a text beside an element in one parent has no box a rule could reach.
 *
 * On a landed page the marks do nothing, and each rule sets a paint property and none a box, so the waiting block is
 * laid out as the landed one is, by the one recipe, and cannot drift from it as a placeholder drawn by hand does. A
 * part left unmarked shows its sample's underscores.
 *
 * The sample is kept beside its block, in the block's file, and has the shape of what lands: as many rows, and in each
 * slot the read fills as many words, as the block usually holds, short enough to fit the slot, since a cut one shows
 * the cut's „…“. Those words are `waitSample`'s, runs of underscores, never ink a person reads, only width: a public
 * page is prerendered, so a fallback's markup reaches every reader and every crawler, and a made-up name in it would be
 * content the site never published. What is known before the read is passed as it is. A link in the sample has no address (`href: null`), which HTML
 * calls a placeholder for a link: nothing follows it, Next prefetches nothing for it, and it is no client component,
 * so a block of links waits as markup alone.
 *
 * It holds a block's place and no more, so the page's layout keeps two rules around it. The layout owns every box above
 * the wait: a title, a toolbar and a table's head stand outside the boundary, drawn before any read. And the waiting
 * region is the last thing in its page, with nothing visible under it, so content landing taller or shorter than its
 * sample pushes nothing. A block that stands above other content takes its height from its container instead, a grid
 * track or the least height of its tallest state, never from its sample.
 *
 * It is not the busy region. `aria-hidden` would hide its own `aria-busy` from the one tree that reads it, and a part of
 * the frame waits without being its page's status. In a template's boundary it stands inside `Waiting`, which says
 * busy; a part of the frame stands in it alone.
 *
 * It adds no box (`display: contents`), so the block's root is laid out by the container the landed block stands in,
 * which is how a wait and its content share one layout: the container that owns the layout stays outside the boundary
 * (Next's guide to the static shell). A box of its own would repeat that container's layout by hand. The wrapper is
 * still an element, so a selector reading a child's place, `first:` or `*:`, reads it in place of the block: it wraps a
 * block whose root reads no place among its siblings, or every sibling at once.
 *
 * `inert` takes the focus, the press and the find-in-page from everything inside, and the accessibility tree with them;
 * `aria-hidden` says the last to a reader older than `inert`.
 *
 * What drawing the block itself cannot do:
 * - Text that wraps unlike its sample changes its block's height, which only the last region may do.
 * - A block whose shape the read decides, such as a bracket by its number of teams, has no sample: its container gives
 *   it a box, and one bar fills it. A picture waits the same way, since a sample's file would be fetched.
 * - A client component inside is hydrated as any other is, and one that needs a live action takes empty values.
 */
export function Pending({ children }: { children: ReactNode }) {
  return (
    <div
      data-kit-pending
      aria-hidden
      inert
      className="contents">
      {children}
    </div>
  );
}
