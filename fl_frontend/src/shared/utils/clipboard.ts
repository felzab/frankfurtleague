/**
 * The property access sits inside the `try` on purpose: `navigator.clipboard` is `undefined` outside a secure context,
 * so the call throws synchronously before a promise exists and a `.catch()` on it would never run.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Two constants because a toast's title is the outcome and its description the detail; the first line alone must carry it. */
export const CLIPBOARD_ERROR_TITLE = "Kopieren nicht möglich";
export const CLIPBOARD_ERROR_DETAIL = "Die Zwischenablage ist in diesem Kontext nicht verfügbar.";
