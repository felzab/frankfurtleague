/**
 * The Trainer seat, filled from the seat that declared itself the coach.
 *
 * **Composed, never written into a draft.** The seat that made the claim is where the person is
 * edited, so the Trainer's own entry survives the claim being lifted. A mirror written into state
 * overwrites one of two real people on the first keystroke, with no undo and nothing said.
 */
export function mirrorTrainerSeat<Seat extends string, Person, Block extends Record<Seat, Person> & { trainer: Person }>(
  block: Block & { trainer_ist_zugleich: Seat | null },
): Block & { trainer_ist_zugleich: Seat | null } {
  const seat = block.trainer_ist_zugleich;

  return seat === null ? block : { ...block, trainer: block[seat] };
}
