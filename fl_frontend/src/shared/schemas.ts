import { z } from "zod";

// Each schema mirrors a constraint in `fl_backend/app/shared/schemas/custom.py`; looser makes the
// message a lie, and a pattern is outside the contract comparison entirely.

// A literal space, never `\s`, which inside the anchors would admit newlines and tabs.
const PHONE_REGEX = new RegExp(/^([+]?[ 0-9\-().]{3,20})$/);

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
  error: "Ungültige Auswahl. Bitte wähle den Eintrag erneut aus.",
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
  // `*` not `+`, so "optional" is the pattern rather than a union: a union whose branches both fail can
  // surface a branch's message, putting zod's raw English in front of an admin.
  hausnummer: z.string().regex(/^[\d\-abcABC]*$/, {
    error: "Die Hausnummer darf nur aus Zahlen, Bindestrichen und den Buchstaben a, b, c bestehen.",
  }),
  plz: z.string().regex(/^\d{5}$/, { error: "Die PLZ muss genau 5 Ziffern haben." }),
  stadtteil: z.string(),
  stadt: z.string().nonempty({ error: "Bitte gib eine Stadt ein." }),
});
export type FLAddress = z.infer<typeof FLAddressSchema>;

export const FLKontaktSchema = z.object({
  // The message has to sit on the union: with `.or()` the branch messages are unreachable and zod falls
  // back to its own English.
  telefon: z
    .union([z.string().regex(PHONE_REGEX), z.string().trim().length(0)], {
      error: "Bitte gib eine gültige Telefonnummer ein.",
    })
    .nullable(),
  email: z.union([z.email(), z.string().trim().length(0)], { error: "Bitte gib eine gültige E-Mail-Adresse ein." }).nullable(),
});
export type FLKontakt = z.infer<typeof FLKontaktSchema>;
