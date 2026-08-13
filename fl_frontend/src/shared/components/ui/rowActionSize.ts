/**
 * SHARED · the admin row action's target size
 *
 * **One declaration, because a placeholder has to reserve exactly what arrives.** A row action is the
 * tallest thing in an admin row, so this size plus the cells' padding is the row's height, and it is
 * what `AdminCrudFallback` reserves while the rows are in flight.
 *
 * **Its own module rather than an export of `RowActions`**, which is `"use client"`: the fallback is
 * deliberately a server component, and an export crossing that boundary arrives as a client reference
 * instead of a string; a module with no directive is readable from either side.
 *
 * Invariants:
 * - `RowActions` and `AdminCrudFallback` read this constant rather than spelling it: spelled at both,
 *   a change to one leaves the other short by the difference, on every row, with the whole gate green.
 */
export const ROW_ACTION_SIZE = "h-10 w-10";
