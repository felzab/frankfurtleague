/**
 * The side acts a running change's row draws, in their order: the fresh link where the change waits on the new
 * mailbox, then the ending. `ChangeActs` draws one act per entry, and the page hands the row the count of them, which its
 * list reads to decide the acts' form for all its rows (`SideActs`) before any of them renders. Apart from
 * `ChangeActs.tsx`, a client module, whose functions a server page receives as references it cannot call.
 */
export function changeActKinds(resends: boolean): readonly ("send" | "end")[] {
  return resends ? ["send", "end"] : ["end"];
}
