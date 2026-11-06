// Redesign: goes with its last importer.
import { z } from "zod";

import { hasAsciiLocalPart, isDeliverableAddress, isSpecialUseAddress, KONTAKT_EMAIL_MAX_LENGTH } from "@/core/emailAddress";

// Each schema mirrors a constraint in `fl_backend/app/shared/schemas/custom.py`,
// `fl_backend/app/shared/schemas/addresses.py` or, for an email address,
// `fl_backend/app/shared/schemas/kontakt.py :: CustomEmail`; on a WRITE, looser makes the message a lie.

/**
 * `YYYY-MM-DD`, and a day that exists — `z.iso.date()` is a calendar regex rather than a shape one. The refinement
 * closes the one value it and `CustomDateString` disagree on: `\d{4}` admits year 0000 where Python refuses it.
 */
export const CustomDateStringSchema = z.iso
  .date({ error: "Bitte gib ein gültiges Datum ein." })
  .refine((value) => !value.startsWith("0000"), { error: "Bitte gib ein gültiges Datum ein." });

// Named rather than written into the schema below.
const TIME_REGEX = /^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/;

/**
 * `HH:MM:SS`, seconds required. Not `z.iso.time()`, which also accepts `"14:30"` and `"14:30:00.5"` where the backend's
 * `CustomTimeString` refuses both — the looser schema would let the form submit a value the API answers with a 422.
 */
export const CustomTimeStringSchema = z.string().regex(TIME_REGEX, { error: "Bitte gib eine gültige Uhrzeit ein." });

// Re-exported rather than moved out of every call site: a read model declared in `core` validates
// the same ids, and `eslint.config.mjs :: LAYER_BOUNDARY` refuses `core` this module.
export { CustomObjectIdStringSchema } from "@/core/objectId";

// Named rather than written into the schema below.
// `u` is what makes `\p{L}` a Unicode property class here rather than the letter `p`.
const PERSON_NAME_REGEX = /^\p{L}[\p{L}\-' ]*$/u;

/**
 * Letters by Unicode property rather than `[A-Za-z]`; digits and symbols are out, which is what stops a note being
 * typed into a name field. **On the write path only** — a read model refusing a stored name 500s the whole response.
 */
export const PersonNameSchema = z
  .string()
  // First, as `fl_backend/app/shared/schemas/kontakt.py :: CustomKontaktName` strips before its ceiling and pattern:
  // counted untrimmed, a space typed after a name at the ceiling refuses what the API takes.
  .trim()
  .nonempty({ error: "Bitte gib einen Namen ein." })
  .regex(PERSON_NAME_REGEX, { error: "Ein Name darf nur Buchstaben, Leerzeichen, Bindestriche und Apostrophe enthalten." });

// `fl_backend/app/shared/schemas/custom.py :: SINGLE_LINE_PATTERN` negated, and named rather than written into the
// refinement below.
const NOT_SINGLE_LINE = /[\x00\n\v\f\r\u0085\u2028\u2029]/;

/**
 * A name is a name: none of them belongs in one, and refusing the class is cheaper than
 * reasoning about each renderer downstream. CR and LF forge a fact
 * line in a decision mail besides.
 */
// One asymmetry, fail-closed: the API's `strip_whitespace` drops U+0085 where `trim()` keeps it, so a value PADDED
// with one is taken by the API and refused here.
export const singleLineName = (schema: z.ZodString, field: string) =>
  schema.refine((value) => !NOT_SINGLE_LINE.test(value), {
    error: `${field} darf keine Zeilenumbrüche oder Steuerzeichen enthalten.`,
  });

/**
 * Re-exported from `core`, where `isDeliverableAddress` holds the same ceiling: applied here so an
 * over-long address is refused in German at the keystroke, the API's `payload_refused` marking the box
 * with a generic sentence rather than the ceiling's own.
 */
export { KONTAKT_EMAIL_MAX_LENGTH };

const addressBox = z
  // What a cleared box answers where its form submits `null` for one.
  .string({ error: "Bitte gib eine E-Mail-Adresse ein." })
  // Pydantic strips before it validates, so a pasted trailing space is an address the API takes.
  .trim();

/**
 * An address box judged by `accepts`: the erasure's lookup accepts more than a write does, and the
 * messages are one set, so a rewording reaches both.
 */
export function addressSchema(accepts: (address: string) => boolean, box: z.ZodString = addressBox) {
  return (
    box
      // Ahead of `accepts` and ending the judgement: `isDeliverableAddress` holds the same ceiling in
      // octets, so a long address would otherwise carry the generic sentence beside this one.
      .max(KONTAKT_EMAIL_MAX_LENGTH, {
        error: `Die E-Mail-Adresse darf höchstens ${String(KONTAKT_EMAIL_MAX_LENGTH)} Zeichen lang sein.`,
        abort: true,
      })
      .refine(accepts, { error: "Bitte gib eine gültige E-Mail-Adresse ein." })
  );
}

/**
 * Every address typed to be stored or signed in with is judged here. `z.email()` cannot be it: its
 * default alphabet refuses atext characters the API takes, and its `html5Email` takes the doubled dot the API refuses.
 */
const asciiLocalBox = addressBox.refine(hasAsciiLocalPart, {
  // First and alone: the one refusal nobody can read out of the generic sentence. It asks for another
  // address and never a retyped one: the same mailbox spelled without its umlaut is a stranger's.
  error: "Diese Adresse können wir nicht nutzen: Vor dem @ dürfen keine Umlaute, kein ß, keine Akzente und keine anderen Schriften stehen.",
  abort: true,
});

/**
 * A reserved domain worded ahead of the generic sentence, which `isDeliverableAddress` would
 * otherwise answer it with. Last on the box, so the umlaut refusal above is shown in its place.
 */
export const KontaktEmailSchema = addressSchema(
  isDeliverableAddress,
  asciiLocalBox.refine((address) => !isSpecialUseAddress(address), {
    error: "Diese Adresse können wir nicht nutzen: Der Teil nach dem @ ist reserviert und empfängt keine E-Mails.",
    abort: true,
  }),
);
