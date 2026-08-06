/**
 * Copies text to the clipboard, reporting success as a boolean rather than a rejected promise.
 *
 * The property access is inside the `try` on purpose. `navigator.clipboard` is
 * `undefined` outside a secure context — a plain-HTTP LAN origin, which is exactly how an admin
 * tests these buttons from a phone — so `navigator.clipboard.writeText(...)` throws a synchronous
 * `TypeError` *before* a promise exists. A `.catch()` on the call therefore never runs, and the
 * button fails with no feedback at all. Awaiting inside the block catches both that and a
 * permissions rejection.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The one failure for a copy that could not run — the cause is the origin, not the data.
 *
 * Two constants rather than one sentence, because a toast's title is the outcome and its description
 * is the detail: the reader who only takes in the first line still learns that nothing was copied.
 */
export const CLIPBOARD_ERROR_TITLE = "Kopieren nicht möglich";
export const CLIPBOARD_ERROR_DETAIL = "Die Zwischenablage ist in diesem Kontext nicht verfügbar.";
