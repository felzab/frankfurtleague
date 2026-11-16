/** A redirect Next threw: where it sends, how it replaces the history entry, and its status. */
export type ThrownRedirect = { readonly address: string; readonly type: string; readonly status: number };

/**
 * The redirect `pending` throws, read off the error's digest, `NEXT_REDIRECT;<type>;<address>;<status>;`, which Next
 * documents nowhere: its own reader is in a private build path, so the one parse of it stands here. An address may hold
 * a semicolon of its own. Anything else `pending` throws is thrown on, and an answer fails the case, so a crash never
 * reads as a redirect to nowhere.
 */
export async function thrownRedirect(pending: Promise<unknown>): Promise<ThrownRedirect> {
  const thrown: unknown = await pending.then(
    () => {
      throw new Error("answered rather than redirected");
    },
    (error: unknown) => error,
  );
  const digest: unknown = thrown instanceof Error && "digest" in thrown ? thrown.digest : undefined;
  const parts = typeof digest === "string" ? digest.split(";") : [];
  if (parts[0] !== "NEXT_REDIRECT" || parts.length < 5) throw thrown;
  return { type: parts[1] ?? "", address: parts.slice(2, -2).join(";"), status: Number(parts.at(-2)) };
}
