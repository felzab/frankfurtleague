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

/**
 * The one sentence under every failed copy: the browser's refusal is the same wherever the press is,
 * while the title names the thing that press was after and is written at the press.
 */
export const CLIPBOARD_ERROR_DETAIL = "Dieser Browser gibt die Zwischenablage nicht frei.";
