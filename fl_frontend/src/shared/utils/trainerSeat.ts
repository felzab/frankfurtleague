/**
 * Filled from the seat that declared itself the coach, and composed, not written into a draft: the
 * claiming seat is where the person is edited, so lifting the claim keeps the Trainer's entry, where a
 * mirror in state overwrites a real person silently.
 */
export function mirrorTrainerSeat<Seat extends string, Person, Block extends Record<Seat, Person> & { trainer: Person }>(
  block: Block & { trainer_ist_zugleich: Seat | null },
): Block & { trainer_ist_zugleich: Seat | null } {
  const seat = block.trainer_ist_zugleich;

  return seat === null ? block : { ...block, trainer: block[seat] };
}
