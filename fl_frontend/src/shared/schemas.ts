import { z } from "zod";

// Each schema mirrors a constraint in `fl_backend/app/shared/schemas/custom.py` or
// `fl_backend/app/shared/schemas/addresses.py`; on a WRITE, looser makes the message a lie, and a
// pattern is outside the contract comparison entirely.

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

// Named rather than written into `FLAddressSchema`, so `fl_backend/tests/shared/test_frontend_mirrors.py :: MIRRORED_PATTERNS`
// can pair it with the backend's spelling: a literal inside a schema call is reachable by no comparison at all.
const PLZ_REGEX = /^\d{5}$/;

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
  plz: z.string().regex(PLZ_REGEX, { error: "Die PLZ muss genau 5 Ziffern haben." }),
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
    .trim()
    .nonempty({ error: "Bitte gib eine Straße ein." })
    .max(ADDRESS_STRASSE_MAX_LENGTH, { error: `Die Straße darf höchstens ${String(ADDRESS_STRASSE_MAX_LENGTH)} Zeichen lang sein.` }),
  stadt: z
    .string()
    .trim()
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

/**
 * RFC 5322 3.2.3's atext, extended by RFC 6531 3.3 to every code point above ASCII and narrowed by
 * the two categories `EmailStr` calls unsafe, `Z` and `C`.
 */
const EMAIL_ATOM = "(?:[a-zA-Z0-9_!#$%&'*+\\-/=?^`{|}~]|[^\\p{ASCII}\\p{Z}\\p{C}])+";

// A combining mark may not OPEN the local part: it would combine with whatever text precedes the address.
/**
 * No ceiling on the local part: email-validator applies RFC 5321's 64 only under `strict`, which
 * pydantic does not pass, so one here would refuse an address the API accepts.
 */
const EMAIL_LOCAL_PART_REGEX = new RegExp(`^(?!\\p{M})${EMAIL_ATOM}(?:\\.${EMAIL_ATOM})*$`, "u");

/** Read before `new URL` below, which would take a slash or a colon here for a path or a port and answer a host nobody typed. */
const EMAIL_HOST_CHARS_REGEX = /^(?:[a-zA-Z0-9\-.]|[^\p{ASCII}\p{Z}\p{C}])+$/u;

/** RFC 1123 2.1's letter-digit-hyphen label, which is the clause that refuses `person@ab-.de`. */
const EMAIL_HOST_LABEL_REGEX = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;

/** Every delegated top-level domain ends in a letter, so this refuses a host that is an IP address without parsing one. */
const EMAIL_HOST_TLD_REGEX = /[a-zA-Z]$/;

// RFC 1035 2.3.4 and 2.3.1, in octets of the punycoded host: an umlaut label transmits longer than it reads.
const EMAIL_HOST_MAX_OCTETS = 253;
const EMAIL_HOST_LABEL_MAX_OCTETS = 63;

// The API's refusals that rest on a registry rather than on characters stay the API's: IDNA 2008's
// code-point tables, RFC 5890's reserved labels, and IANA's special-use names.
/** `EmailStr`'s own three checks: the local part's alphabet, the host's, and the host's lengths after punycoding. */
function isDeliverableAddress(value: string): boolean {
  const at = value.lastIndexOf("@");
  if (at < 1 || !EMAIL_LOCAL_PART_REGEX.test(value.slice(0, at))) return false;

  const host = value.slice(at + 1);
  if (!EMAIL_HOST_CHARS_REGEX.test(host)) return false;

  let punycoded: string;
  try {
    // The only punycode route a browser offers, and `EmailStr` measures the lengths below on this form too.
    punycoded = new URL(`https://${host}`).hostname;
  } catch {
    return false;
  }
  if (punycoded.length > EMAIL_HOST_MAX_OCTETS || !EMAIL_HOST_TLD_REGEX.test(punycoded)) return false;

  const labels = punycoded.split(".");
  // A host with no dot is deliverable nowhere, which is the reason `EmailStr` refuses one.
  return labels.length > 1 && labels.every((label) => label.length <= EMAIL_HOST_LABEL_MAX_OCTETS && EMAIL_HOST_LABEL_REGEX.test(label));
}

/**
 * Every write path's address rule, spelled once. `z.email()` cannot be it: its alphabet refuses the
 * umlaut local part and the unicode host `EmailStr` stores, so a school with either could not apply.
 */
export const KontaktEmailSchema = z
  .string()
  // Pydantic strips before it validates, so a pasted trailing space is an address the API takes.
  .trim()
  .refine(isDeliverableAddress, { error: "Bitte gib eine gültige E-Mail-Adresse ein." })
  .max(KONTAKT_EMAIL_MAX_LENGTH, { error: `Die E-Mail-Adresse darf höchstens ${String(KONTAKT_EMAIL_MAX_LENGTH)} Zeichen lang sein.` });

export const FLKontaktSchema = z.object({
  // The message has to sit on the union: with `.or()` the branch messages are unreachable and zod falls
  // back to its own English.
  telefon: z
    .union([z.string().regex(PHONE_REGEX), z.string().trim().length(0)], {
      error: "Bitte gib eine gültige Telefonnummer ein.",
    })
    .nullable(),
  // Judged on the payload alone: `EmailStr` normalises a punycode host to unicode and takes an umlaut
  // local part, so a read stating an address rule refuses a value the API stored.
  email: z.string().nullable(),
});
export type FLKontakt = z.infer<typeof FLKontaktSchema>;

/** What the two referee payloads embed: the write is where the address rule applies and a refusal reaches a box. */
export const FLKontaktPayloadSchema = FLKontaktSchema.extend({
  // The empty branch is what a cleared box submits, and the union's message covers both: a branch's
  // own sentence is unreachable once the union carries one, the ceiling's among them.
  email: z
    .union([KontaktEmailSchema, z.string().trim().length(0)], {
      error: "Bitte gib eine gültige E-Mail-Adresse ein.",
    })
    .nullable(),
});
