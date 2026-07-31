import { z } from "zod";

const PHONE_REGEX = new RegExp(/^([+]?[\s0-9\-().]{3,20})$/);

export const CustomDateStringSchema = z.iso.date({ error: "DateString has to be of the form: YYYY-MM-DD" });

/**
 * `HH:MM:SS`, seconds required.
 *
 * Not `z.iso.time()`, which also accepts `"14:30"` and `"14:30:00.5"`. The backend's
 * `CustomTimeString` requires seconds and rejects a fractional part, so the looser schema let the
 * admin form submit a value the API answered with a 422 — and made the error message here a lie
 * about what it accepted (audit R3a §B1.4).
 */
export const CustomTimeStringSchema = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$/, { error: "TimeString has to be of the form: HH:MM:SS" });

export const CustomObjectIdStringSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, {
  error: "ObjectIdString has to be 24 chars long and a combination of letters and numbers",
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
export const ExternalUrlSchema = z.url({ protocol: /^https?$/, hostname: z.regexes.domain });

export const FLAddressSchema = z.object({
  strasse: z.string().nonempty({ error: "Bitte gib eine Straße ein." }),
  hausnummer: z
    .string()
    .regex(/^[\d\-abcABC]+$/, "Die Hausnummer darf nur aus Zahlen, Bindestrichen und den Buchstaben a, b, c bestehen.")
    .or(z.literal("")),
  plz: z.string().regex(/^\d{5}$/, "Die PLZ muss genau 5 Ziffern haben."),
  stadtteil: z.string(),
  stadt: z.string().nonempty({ error: "Bitte gib eine Stadt ein." }),
});
export type FLAddress = z.infer<typeof FLAddressSchema>;

export const FLKontaktSchema = z.object({
  telefon: z.string().regex(PHONE_REGEX, "Ungültige Telefonnummer").or(z.string().trim().length(0)).nullable(),
  email: z.email().or(z.string().trim().length(0)).nullable(),
});
export type FLKontakt = z.infer<typeof FLKontaktSchema>;
