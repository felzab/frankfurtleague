/**
 * The property access sits inside the `try` on purpose: `navigator.clipboard` is `undefined` outside a secure context,
 * so the call throws synchronously before a promise exists and a `.catch()` on it would never run.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  // Refused rather than written: the answer promises the reader can paste what was handed over, and
  // an empty write leaves them pasting whatever the clipboard held before it.
  if (text === "") return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
