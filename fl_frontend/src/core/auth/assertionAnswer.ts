/**
 * What the passkey assertion answers the page: that it signed in, and the address of the account it signed in.
 * `fl_frontend/src/core/auth/library.ts` writes it in place of the plugin's own answer, whose session row carries the
 * cookie's own value, so the plugin client's typed `data.user` is never there. The touch
 * (`fl_frontend/src/kit/usePasskeyTouch.ts`) reads the address to refuse a passkey of another account than the
 * page's, and both sides build and read the answer here, so neither can name a field the other drops.
 */
type AssertionAnswer = { status: true; email: string };

/** The assertion's answer for the account at `email`. */
export function assertionAnswer(email: string): AssertionAnswer {
  return { status: true, email: email };
}

/**
 * The address the assertion signed in, read off its answer; `null` where the answer names none. Read by hand rather than
 * by a schema: the touch runs in the browser, where Zod would ship to every page holding an account box.
 */
export function assertedAddress(answer: unknown): string | null {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return null;
  // Keyed off the answer's own type, so a field renamed there is a field this read no longer names.
  const read: { [Field in keyof AssertionAnswer]?: unknown } = answer;
  return read.status === true && typeof read.email === "string" ? read.email : null;
}
