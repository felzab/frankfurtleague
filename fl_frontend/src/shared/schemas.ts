import { z } from "zod";

// Each schema mirrors a constraint in `fl_backend/app/shared/schemas/custom.py`; looser makes the
// message a lie, and a pattern is outside the contract comparison entirely.

/**
 * A literal space, never `\s`, which inside the anchors would admit newlines and tabs. Exported
 * because `FLKontaktpersonSchema` needs the same rule where the field is required rather than optional.
 */
export const PHONE_REGEX = new RegExp(/^([+]?[ 0-9\-().]{3,20})$/);

// Shared, because the payload redeclares the field for its ceiling and a duplicated alphabet would drift. `*` not
// `+`, so "optional" is the pattern rather than a union: a union whose branches both fail surfaces zod's raw English.
const HAUSNUMMER_REGEX = /^[\d\-abcABC]*$/;
const HAUSNUMMER_ERROR = "Die Hausnummer darf nur aus Zahlen, Bindestrichen und den Buchstaben a, b, c bestehen.";

/**
 * `YYYY-MM-DD`, and a day that exists — `z.iso.date()` is a calendar regex rather than a shape one. The refinement
 * closes the one value it and `CustomDateString` disagree on: `\d{4}` admits year 0000 where Python refuses it.
 */
export const CustomDateStringSchema = z.iso
  .date({ error: "Bitte gib ein gültiges Datum ein." })
  .refine((value) => !value.startsWith("0000"), { error: "Bitte gib ein gültiges Datum ein." });

/**
 * `HH:MM:SS`, seconds required. Not `z.iso.time()`, which also accepts `"14:30"` and `"14:30:00.5"` where the backend's
 * `CustomTimeString` refuses both — the looser schema would let the form submit a value the API answers with a 422.
 */
export const CustomTimeStringSchema = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, { error: "Bitte gib eine gültige Uhrzeit ein." });

export const CustomObjectIdStringSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, {
  // German, like every message here, because a failure reaches a `<FieldError>` under a picker rather than a console.
  error: "Bitte wähle den Eintrag erneut aus.",
});

/**
 * For **any** backend-supplied URL reaching an `href`, `src` or `action`, and never bare `z.url()` there: that checks a
 * string parses rather than what scheme it uses, so `javascript:` passes it — a stored-XSS sink on any page linking out.
 */
export const ExternalUrlSchema = z.url({
  protocol: /^https?$/,
  hostname: z.regexes.domain,
  error: "Bitte gib eine gültige Adresse ein, die mit http:// oder https:// beginnt.",
});

/**
 * Letters by Unicode property rather than `[A-Za-z]`; digits and symbols are out, which is what stops a note being
 * typed into a name field. **On the write path only** — a read model refusing a stored name 500s the whole response.
 */
export const PersonNameSchema = z
  .string()
  .nonempty({ error: "Bitte gib einen Namen ein." })
  .regex(/^\p{L}[\p{L}\-' ]*$/u, { error: "Ein Name darf nur Buchstaben, Leerzeichen, Bindestriche und Apostrophe enthalten." });

export const FLAddressSchema = z.object({
  strasse: z.string().nonempty({ error: "Bitte gib eine Straße ein." }),
  hausnummer: z.string().regex(HAUSNUMMER_REGEX, { error: HAUSNUMMER_ERROR }),
  plz: z.string().regex(/^\d{5}$/, { error: "Die PLZ muss genau 5 Ziffern haben." }),
  stadtteil: z.string(),
  stadt: z.string().nonempty({ error: "Bitte gib eine Stadt ein." }),
});
export type FLAddress = z.infer<typeof FLAddressSchema>;

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
 * Mirrors `FLAddressPayload` — what every write payload embeds. The ceilings are here and not on `FLAddressSchema`,
 * which the read schemas embed: a stored value over one of them must still parse, or one row fails a whole list.
 */
export const FLAddressPayloadSchema = FLAddressSchema.extend({
  strasse: z
    .string()
    .nonempty({ error: "Bitte gib eine Straße ein." })
    .max(ADDRESS_STRASSE_MAX_LENGTH, { error: `Die Straße darf höchstens ${String(ADDRESS_STRASSE_MAX_LENGTH)} Zeichen lang sein.` }),
  stadt: z
    .string()
    .nonempty({ error: "Bitte gib eine Stadt ein." })
    .max(ADDRESS_STADT_MAX_LENGTH, { error: `Die Stadt darf höchstens ${String(ADDRESS_STADT_MAX_LENGTH)} Zeichen lang sein.` }),
  // No floor beside the ceiling: a district is the part of an address a place can genuinely lack, so the payload
  // bounds its length alone.
  stadtteil: z.string().max(ADDRESS_STADTTEIL_MAX_LENGTH, {
    error: `Der Stadtteil darf höchstens ${String(ADDRESS_STADTTEIL_MAX_LENGTH)} Zeichen lang sein.`,
  }),
  // Restated beside the ceiling because extending replaces the field outright, and the alphabet alone bounds nothing.
  hausnummer: z
    .string()
    .regex(HAUSNUMMER_REGEX, { error: HAUSNUMMER_ERROR })
    .max(ADDRESS_HAUSNUMMER_MAX_LENGTH, {
      error: `Die Hausnummer darf höchstens ${String(ADDRESS_HAUSNUMMER_MAX_LENGTH)} Zeichen lang sein.`,
    }),
});
export type FLAddressPayload = z.infer<typeof FLAddressPayloadSchema>;

/**
 * The whole-address ceiling, mirrored from `fl_backend/app/shared/schemas/bounds.py`. Bound here so an over-long address is refused
 * in German at the keystroke: the API refuses it with a bare `REQ-VAL-001` and no field detail, so nothing marks the box.
 */
export const KONTAKT_EMAIL_MAX_LENGTH = 254;

export const FLKontaktSchema = z.object({
  // The message has to sit on the union: with `.or()` the branch messages are unreachable and zod falls
  // back to its own English.
  telefon: z
    .union([z.string().regex(PHONE_REGEX), z.string().trim().length(0)], {
      error: "Bitte gib eine gültige Telefonnummer ein.",
    })
    .nullable(),
  // No local-part cap beside it: email-validator applies RFC 5321's 64 only under `strict`, which
  // pydantic does not pass, so one here alone would refuse an address the API accepts.
  email: z
    .union([z.email().max(KONTAKT_EMAIL_MAX_LENGTH), z.string().trim().length(0)], {
      error: "Bitte gib eine gültige E-Mail-Adresse ein.",
    })
    .nullable(),
});
export type FLKontakt = z.infer<typeof FLKontaktSchema>;
