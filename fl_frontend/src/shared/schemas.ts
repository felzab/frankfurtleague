/**
 * SHARED · scalar schemas
 *
 * The primitive types every slice's models are built from: ids, dates, times, phone numbers,
 * addresses and external URLs.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Each of these MIRRORS a backend constraint in `app/shared/schemas/custom.py`. The backend is the
 *     source of truth; a looser schema here accepts values the API then rejects with a 422, and makes
 *     the client-side error message a lie about what was allowed.
 *   • External URLs are scheme-restricted. A bare URL check accepts `javascript:` and `data:`, which
 *     become XSS sinks once rendered into an href.
 *   • Error messages are German and user-facing — these schemas back admin form fields directly.
 */

import { z } from "zod";

const PHONE_REGEX = new RegExp(/^([+]?[\s0-9\-().]{3,20})$/);

export const CustomDateStringSchema = z.iso.date({ error: "Bitte gib ein gültiges Datum ein." });

/**
 * `HH:MM:SS`, seconds required.
 *
 * Not `z.iso.time()`, which also accepts `"14:30"` and `"14:30:00.5"`. The backend's
 * `CustomTimeString` requires seconds and rejects a fractional part, so the looser schema let the
 * looser schema would let the admin form submit a value the API answers with a 422, and would make
 * the error message here a lie about what it accepts.
 */
export const CustomTimeStringSchema = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, { error: "Bitte gib eine gültige Uhrzeit ein." });

export const CustomObjectIdStringSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, {
  // German because a failure here reaches a `<FieldError>` under a picker, not a console.
  error: "Ungültige Auswahl. Bitte wähle den Eintrag erneut aus.",
});

/**
 * Use this for **any** backend-supplied URL that ends up in an `href`, `src` or `action`.
 *
 * Never use bare `z.url()` for that. It checks that a string *parses* as a URL, not what scheme it
 * uses, so `javascript:alert(1)`, `data:text/html,...` and `vbscript:x` all pass it — and React
 * renders such an href without complaint. That was a live stored-XSS sink on the public team pages
 * (audit R3b §S8.1). `hostname` additionally rejects scheme-only junk like `https://ok`.
 *
 * Bare `z.url()` remains correct for values that are never rendered as a link, such as server
 * configuration in `src/core/config.ts`.
 */
// German because the team form binds this schema to a text input; on a response parse the message
// is only ever logged.
export const ExternalUrlSchema = z.url({
  protocol: /^https?$/,
  hostname: z.regexes.domain,
  error: "Bitte gib eine gültige Adresse ein, die mit http:// oder https:// beginnt.",
});

export const FLAddressSchema = z.object({
  strasse: z.string().nonempty({ error: "Bitte gib eine Straße ein." }),
  // `*` not `+`, so "optional" is expressed by the pattern rather than by a union. A union whose
  // branches both fail can surface a BRANCH's message instead of its own, which is how this field
  // ended up showing zod's raw "Invalid string: must match pattern ..." to an admin.
  hausnummer: z.string().regex(/^[\d\-abcABC]*$/, {
    error: "Die Hausnummer darf nur aus Zahlen, Bindestrichen und den Buchstaben a, b, c bestehen.",
  }),
  plz: z.string().regex(/^\d{5}$/, { error: "Die PLZ muss genau 5 Ziffern haben." }),
  stadtteil: z.string(),
  stadt: z.string().nonempty({ error: "Bitte gib eine Stadt ein." }),
});
export type FLAddress = z.infer<typeof FLAddressSchema>;

export const FLKontaktSchema = z.object({
  // Both fields are optional, so each is "a valid value OR blank" -- a union. The message has to sit
  // on the union: with `.or()` the branch messages are unreachable and zod falls back to its own
  // English "Invalid input", which is what these two fields were showing.
  telefon: z
    .union([z.string().regex(PHONE_REGEX), z.string().trim().length(0)], {
      error: "Bitte gib eine gültige Telefonnummer ein.",
    })
    .nullable(),
  email: z.union([z.email(), z.string().trim().length(0)], { error: "Bitte gib eine gültige E-Mail-Adresse ein." }).nullable(),
});
export type FLKontakt = z.infer<typeof FLKontaktSchema>;
