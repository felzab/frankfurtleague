/**
 * The side acts a seat row draws, in their order: the fresh link while the seat waits on someone, then the edit.
 * `SeatActs` draws one act per entry, and the page hands the row the count of them, which its list reads to decide the
 * acts' form for all its rows (`SideActs`) before any of them renders. Apart from `SeatActs.tsx`, a client module,
 * whose functions a server page receives as references it cannot call.
 */
export function seatActKinds(link: object | null): readonly ("send" | "edit")[] {
  return link === null ? ["edit"] : ["send", "edit"];
}
