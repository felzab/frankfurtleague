/**
 * SHELL · the rail's width from `lg` up, in both states
 *
 * **One declaration, because two elements have to agree on it exactly.** The bar's brand block and the
 * navigation rail beneath it share a vertical edge — that seam is what makes the shell read as two
 * columns with a header across them rather than as a header with a panel hanging off it — and a seam
 * is only ever right or visibly wrong. Spelled at both call sites, the two drifted the moment one of
 * them gained a state the other did not.
 *
 * **Only the `lg:` half is shared, and that is the point.** Below `lg` the two elements want opposite
 * things: the rail is a drawer and takes the full `w-sidemenu`, while the bar's brand block holds a
 * hamburger and must size to it. A shared value carrying the base width put a 310px block on a 375px
 * phone and left the page title about 65px to live in — so each element supplies its own base and
 * shares only the width they must both honour.
 */
export const RAIL_WIDTH_LG = {
  expanded: "lg:w-sidemenu",
  collapsed: "lg:w-sidemenu-collapsed",
} as const;
