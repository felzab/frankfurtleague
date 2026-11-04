import { z } from "zod";

/**
 * What the passkey assertion answers the page: that it signed in, and the address of the account it signed in.
 * `fl_frontend/src/core/auth/library.ts` writes it in place of the plugin's own answer, whose session row carries the
 * cookie's own value, so the plugin client's typed `data.user` is never there. The touch
 * (`fl_frontend/src/kit/usePasskeyTouch.ts`) reads the address to refuse a passkey of another account than the
 * page's, and both sides build and read the answer here, so neither can name a field the other drops.
 */
const AssertionAnswerSchema = z.object({ status: z.literal(true), email: z.string() });

type AssertionAnswer = z.infer<typeof AssertionAnswerSchema>;

/** The assertion's answer for the account at `email`. */
export function assertionAnswer(email: string): AssertionAnswer {
  return { status: true, email: email };
}

/** The address the assertion signed in, read off its answer; `null` where the answer names none. */
export function assertedAddress(answer: unknown): string | null {
  const read = AssertionAnswerSchema.safeParse(answer);
  return read.success ? read.data.email : null;
}
