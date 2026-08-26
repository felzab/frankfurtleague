/** One row of a refusable list. `refusal` is why it cannot be taken, and `meta` what the row says otherwise. */
export type RefusableOption = { id: string; name: string; meta: string | null; refusal: string | null };

/**
 * The id a key names, and `null` unless the list offers that row. **The refusal is re-read rather
 * than left to the disabled row**: a pick past a closed one is one every caller's endpoint answers
 * 409, and no form may offer what the write path refuses.
 */
export function pickIfOffered(options: readonly RefusableOption[], key: string | null): string | null {
  const picked = options.find((option) => option.id === key);

  // `=== null` and never a truthiness test: `refusal` carries the reason, and any reason closes the row.
  return picked !== undefined && picked.refusal === null ? picked.id : null;
}
