/**
 * SHARED · scalar schemas
 *
 * The primitive types every slice's models are built from: ids, dates, times, phone numbers,
 * addresses and external URLs.
 *
 * Invariants:
 * - Each mirrors a backend constraint in `fl_backend/app/shared/schemas/custom.py` — looser here
 *   makes the client-side message a lie about what is allowed.
 * - External URLs are scheme-restricted: a bare URL check accepts `javascript:`, an XSS sink.
 * - Error messages are German and user-facing — these back admin form fields directly.
 */

import { z } from "zod";

// A LITERAL SPACE, never `\s`: the class sits INSIDE the anchors, so `\s` there lets the value carry the
// newlines and tabs they exclude. ADR-0033 keeps patterns out of the contract comparison, so nothing
// catches this one drifting from the backend's.
const PHONE_REGEX = new RegExp(/^([+]?[ 0-9\-().]{3,20})$/);

/**
 * `YYYY-MM-DD`, and a day that exists.
 *
 * `z.iso.date()` is a calendar regex rather than a shape one — month lengths and the 400-year leap rule
 * are both in it — which is what makes it the mirror of `CustomDateString`'s `DATE_REGEX` plus
 * `validate_calendar_date`. The refinement closes the one value the two disagree on: `\d{4}` admits year
 * 0000 and `date.fromisoformat` refuses it, because `date.MINYEAR` is 1. That divergence would return a
 * 422 carrying no field path at all (`error_response` sends `error_code` and `correlation_id` alone).
 */
export const CustomDateStringSchema = z.iso
  .date({ error: "Bitte gib ein gültiges Datum ein." })
  .refine((value) => !value.startsWith("0000"), { error: "Bitte gib ein gültiges Datum ein." });

/**
 * `HH:MM:SS`, seconds required.
 *
 * Not `z.iso.time()`, which also accepts `"14:30"` and `"14:30:00.5"`. The backend's
 * `CustomTimeString` requires seconds and rejects a fractional part, so the looser schema would let
 * the admin form submit a value the API answers with a 422, and would make the error message here a
 * lie about what it accepts.
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
 * renders such an href without complaint, which makes a bare `z.url()` a stored-XSS sink on any page
 * that links out. `hostname` additionally rejects scheme-only junk like `https://ok`.
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

/**
 * A PERSON's name: letters, and the three separators a real name uses.
 *
 * Letters are matched by Unicode property, not `[A-Za-z]` — half this league's squads would fail an
 * ASCII rule, and the live data already holds `Körner`, `El Damarawy` and `Anouar`. Space, hyphen and
 * apostrophe are in because a double-barrelled or particled name is not a defect; digits and every
 * other symbol are out, which is what stops a note being typed into a name field — a `(C)` captain
 * marker inside a name field is the shape `is_captain` exists to hold instead (ADR-0048's sibling
 * problem).
 *
 * **On the WRITE path only.** A read model that refuses a stored name 500s the whole response for
 * one bad row rather than showing it: one name the rule cannot accept takes the squad list down for
 * every reader. What this schema is for is what it refuses on the way in.
 */
export const PersonNameSchema = z
  .string()
  .nonempty({ error: "Bitte gib einen Namen ein." })
  .regex(/^\p{L}[\p{L}\-' ]*$/u, { error: "Ein Name darf nur Buchstaben, Leerzeichen, Bindestriche und Apostrophe enthalten." });

export const FLAddressSchema = z.object({
  strasse: z.string().nonempty({ error: "Bitte gib eine Straße ein." }),
  // `*` not `+`, so "optional" is expressed by the pattern rather than by a union. A union whose
  // branches both fail can surface a BRANCH's message instead of its own, which puts zod's raw
  // "Invalid string: must match pattern..." in front of an admin.
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
  // English "Invalid input".
  telefon: z
    .union([z.string().regex(PHONE_REGEX), z.string().trim().length(0)], {
      error: "Bitte gib eine gültige Telefonnummer ein.",
    })
    .nullable(),
  email: z.union([z.email(), z.string().trim().length(0)], { error: "Bitte gib eine gültige E-Mail-Adresse ein." }).nullable(),
});
export type FLKontakt = z.infer<typeof FLKontaktSchema>;
