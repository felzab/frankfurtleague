/**
 * Composed, never written into a draft: the claimed seat is where the person is edited, so lifting
 * the claim gives the Trainer back their own entry where a mirror in state would have overwritten
 * them.
 */
export function mirrorTrainerSeat<Seat extends string, Person, Block extends Record<Seat, Person> & { trainer: Person }>(
  block: Block & { trainer_is_also: Seat | null },
): Block & { trainer_is_also: Seat | null } {
  const seat = block.trainer_is_also;

  return seat === null ? block : { ...block, trainer: block[seat] };
}
