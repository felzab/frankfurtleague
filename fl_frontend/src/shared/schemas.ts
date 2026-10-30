import { z } from "zod";

import { hasAsciiLocalPart, isDeliverableAddress, isSpecialUseAddress, KONTAKT_EMAIL_MAX_LENGTH } from "@/core/emailAddress";

import type * as wire from "@/core/generated/client/types";

// Each schema mirrors a constraint in `fl_backend/app/shared/schemas/custom.py`,
// `fl_backend/app/shared/schemas/addresses.py` or, for an email address,
// `fl_backend/app/shared/schemas/kontakt.py :: CustomEmail`; on a WRITE, looser makes the message a lie.

// The final digit sits outside the class, so no accepted value is punctuation and spaces alone
// (`fl_backend/app/shared/schemas/custom.py :: PHONE_REGEX`).
/**
 * A literal space, never `\s`, which inside the anchors would admit newlines and tabs. Exported
 * because `FLKontaktpersonSchema` needs the same rule where the field is required rather than optional.
 */
export const PHONE_REGEX = new RegExp(/^([+]?[ 0-9\-().]{2,19}[0-9])$/);

// Shared, because the payload redeclares the field for its ceiling and a duplicated alphabet would drift. `*` not
// `+`, so "optional" is the pattern rather than a union: a union whose branches both fail surfaces zod's raw English.
const HAUSNUMMER_REGEX = /^[\d\-abcABC]*$/;
const HAUSNUMMER_ERROR = "Die Hausnummer darf nur aus Zahlen, Bindestrichen und den Buchstaben a, b, c bestehen.";

// Named rather than written into `FLAddressPayloadSchema`: a literal inside a schema call is reachable by no comparison at all.
const PLZ_REGEX = /^\d{5}$/;

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

/** Refused as a URL entirely, which is the format check's answer to give rather than this one's. */
function carriesUserinfo(value: string): boolean {
  try {
    const url = new URL(value);

    return url.username !== "" || url.password !== "";
  } catch {
    return false;
  }
}

/**
 * For **any** backend-supplied URL reaching an `href`, `src` or `action`, and never bare `z.url()` there: that checks a
 * string parses rather than what scheme it uses, so `javascript:` passes it — a stored-XSS sink on any page linking out.
 */
export const ExternalUrlSchema = z
  .url({
    protocol: /^https?$/,
    hostname: z.regexes.domain,
    error: "Bitte gib eine gültige Adresse ein, die mit http:// oder https:// beginnt.",
  })
  // `https://frankfurtleague.de@evil.com` resolves to `evil.com`: everything before the `@` is
  // userinfo, which `hostname` excludes and never checks. A surface that shows the string and
  // follows the host sends a trusting reader to the attacker.
  .refine((value) => !carriesUserinfo(value), { error: "Die Adresse darf keine Anmeldedaten vor dem @-Zeichen enthalten." });

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
 * The address ceilings, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Every frontend enforcement point reads
 * them from here, so the schema below and the inputs bound by them cannot disagree about the cap.
 */
export const ADDRESS_STRASSE_MAX_LENGTH = 120;
export const ADDRESS_STADT_MAX_LENGTH = 80;
// Its own constant rather than `stadt`'s, though the numbers agree: the fields are bounded by separate judgements, so
// raising either must not silently raise the other.
export const ADDRESS_STADTTEIL_MAX_LENGTH = 80;
export const ADDRESS_HAUSNUMMER_MAX_LENGTH = 16;

/**
 * `FLAddressPayload`, what every write payload embeds, judged in the browser: the venue, club and application forms
 * (`AdminSpielortEditForm.tsx`, `AdminTeamEditForm.tsx`, `BewerbungForm.tsx`) parse their slice's payload, which embeds
 * this, and the generated Zod is `server-only`.
 */
export const FLAddressPayloadSchema = z.object({
  strasse: z
    .string()
    .trim()
    .nonempty({ error: "Bitte gib eine Straße ein." })
    .max(ADDRESS_STRASSE_MAX_LENGTH, { error: `Die Straße darf höchstens ${String(ADDRESS_STRASSE_MAX_LENGTH)} Zeichen lang sein.` }),
  // The alphabet alone bounds nothing, so the ceiling stands beside it.
  hausnummer: z
    .string()
    .regex(HAUSNUMMER_REGEX, { error: HAUSNUMMER_ERROR })
    .max(ADDRESS_HAUSNUMMER_MAX_LENGTH, {
      error: `Die Hausnummer darf höchstens ${String(ADDRESS_HAUSNUMMER_MAX_LENGTH)} Zeichen lang sein.`,
    }),
  plz: z.string().regex(PLZ_REGEX, { error: "Die PLZ muss genau 5 Ziffern haben." }),
  // No floor beside the ceiling: a district is the part of an address a place can genuinely lack, so the payload
  // bounds its length alone.
  stadtteil: z.string().max(ADDRESS_STADTTEIL_MAX_LENGTH, {
    error: `Der Stadtteil darf höchstens ${String(ADDRESS_STADTTEIL_MAX_LENGTH)} Zeichen lang sein.`,
  }),
  stadt: z
    .string()
    .trim()
    .nonempty({ error: "Bitte gib eine Stadt ein." })
    .max(ADDRESS_STADT_MAX_LENGTH, { error: `Die Stadt darf höchstens ${String(ADDRESS_STADT_MAX_LENGTH)} Zeichen lang sein.` }),
}) satisfies z.ZodType<wire.FLAddressPayload>;

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
 * Every address typed to be stored or signed in with is judged here. `z.email()` cannot be it: no
 * pattern of its converts an umlaut domain, and its `html5Email` takes the doubled dot the API refuses.
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

/**
 * What the two referee payloads embed: the write is where the address rule applies and a refusal reaches a box. Judged
 * in the browser by the referee forms (`AdminCreateSchiedsrichterForm.tsx`, `AdminSchiedsrichterEditForm.tsx`), which
 * the `server-only` generated Zod cannot serve.
 */
export const FLKontaktPayloadSchema = z.object({
  // The message has to sit on the union: with `.or()` the branch messages are unreachable and zod falls
  // back to its own English.
  telefon: z
    .union([z.string().regex(PHONE_REGEX), z.string().trim().length(0)], {
      error: "Bitte gib eine gültige Telefonnummer ein.",
    })
    .nullable(),
  // Required where the telephone is not: an administrator enters a referee, and the address is how
  // that person learns of it.
  email: KontaktEmailSchema,
}) satisfies z.ZodType<wire.FLKontaktPayload>;
