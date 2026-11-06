/**
 * A typed squad number as every write sends it, the squad editor's and the registration's alike: space
 * around it is no format anybody should fight, and an emptied box is a number nobody wears.
 */
export function nummerPayload(typed: string | null): string | null {
  const trimmed = (typed ?? "").trim();

  return trimmed === "" ? null : trimmed;
}
