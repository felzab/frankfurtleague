/**
 * The form a list gives its rows' side acts (`SideActs`), decided once for all its rows from the count each row states
 * (`Table`'s and `SeatRows`' `sideActs`): whether some row carries any, and whether the list folds them into one „⋯“ at
 * every width, where some row carries three or more, since a row holds at most two buttons beside its words. A module
 * of its own because both lists are drawn on the server, which cannot call a function a client module exports.
 */
export function sideActsForm(rows: ReadonlyArray<{ sideActs?: number }>) {
  const most = Math.max(0, ...rows.map((row) => row.sideActs ?? 0));
  return { carried: most > 0, foldsEverywhere: most > 2 };
}
