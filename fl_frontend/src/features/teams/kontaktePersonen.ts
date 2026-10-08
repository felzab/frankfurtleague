import { asSignInIdentifier } from "@/core/emailAddress";

import type z from "zod";

// Imported by both `fl_frontend/src/features/bewerbungen/schemas.ts` and `./schemas.ts` and by neither
// in turn: the first imports the second at module level, so a rule living in either is an import cycle
// that throws whichever loads first.

/**
 * The pairs of seats that must not be one person, in the order the form shows them. The issue lands
 * on the SECOND of each pair: it is the field the applicant reaches next, and the one to change.
 */
const KONTAKT_PAARE = [
  ["ansprechperson", "stellvertretung"],
  ["ansprechperson", "trainer"],
  ["stellvertretung", "trainer"],
] as const;

/**
 * One address on the sign-in fold, as the API compares two seats: an umlaut domain is its punycode,
 * and „strasse“ beside „straße“ is two domains to sign-in and to IDNA 2008.
 */
export const gleicheAdresse = (a: string, b: string): boolean => asSignInIdentifier(a) === asSignInIdentifier(b) && a.trim() !== "";

// Both spellings of the country code. Neither arm can take the other's value -- `0049…` does not
// start with `49` -- so the order carries nothing.
const TELEFON_LAENDERVORWAHLEN = ["0049", "49"] as const;

/**
 * One spelling per number, mirroring `fl_backend/app/api/teams/schemas.py :: normalise_telefon`.
 * Compared raw, the form accepts a pair the backend refuses as a 422 naming the contact block rather
 * than a box — so the applicant is told to retry what cannot succeed.
 */
function normalisiereTelefon(value: string): string {
  const ziffern = value.replace(/[^0-9]/g, "");

  for (const vorwahl of TELEFON_LAENDERVORWAHLEN) {
    // The second strip takes the trunk zero written as `(0)`, the commonest German spelling of all.
    // An international-format number carries no real leading zero, so dropping one can only be right.
    if (ziffern.startsWith(vorwahl)) return `0${ziffern.slice(vorwahl.length).replace(/^0/, "")}`;
  }

  return ziffern;
}

/**
 * Compared as digits, so `+49 (0)170 …` and `0170 …` are the one number the backend reads them as.
 * No empty-guard beside `gleicheAdresse`'s: `PHONE_REGEX` ends every accepted value in a digit, so
 * none of them normalises to nothing.
 */
const gleicheNummer = (a: string, b: string): boolean => normalisiereTelefon(a) === normalisiereTelefon(b);

/**
 * Two values are compared only where each one's own field accepts it. An empty or malformed box carries its own
 * refusal, and two empty telephone boxes fold to one number.
 */
const feldNimmt = (feld: z.ZodType, wert: unknown): boolean => feld.safeParse(wert).success;

// By value, because `einwilligung` is an object and two equal acknowledgements are two objects. One
// level of nesting is all a contact block has, and `einwilligung` is flat, so entry-wise comparison
// is total.
const gleicherWert = (a: unknown, b: unknown): boolean =>
  typeof a === "object" && a !== null && typeof b === "object" && b !== null
    ? JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
    : a === b;

type Person = { email: string; telefon: string };
type Sitz = "trainer" | "ansprechperson" | "stellvertretung";

/**
 * The two rules every contact block written by anybody keeps, mirroring
 * `fl_backend/app/api/teams/schemas.py :: the_trainer_equals_the_seat_they_also_hold` and
 * `:: the_distinct_people_share_no_email_or_telephone`. An empty seat holds nobody to compare.
 */
export function kontaktePersonenRegeln<P extends Person>({
  email,
  telefon,
  zugleich,
}: {
  email: z.ZodType;
  telefon: z.ZodType;
  zugleich: z.ZodType<Exclude<Sitz, "trainer">>;
}): (kontakte: Record<Sitz, P | null> & { trainer_ist_zugleich: unknown }, ctx: z.core.$RefinementCtx) => void {
  return (kontakte, ctx) => {
    for (const [erste, zweite] of KONTAKT_PAARE) {
      // The declared pair IS one person and shares everything by construction. Every other pair is
      // two people the league has to be able to tell apart when one of them stops answering.
      if (zweite === "trainer" && erste === kontakte.trainer_ist_zugleich) continue;

      const [eine, andere] = [kontakte[erste], kontakte[zweite]];
      if (eine === null || andere === null) continue;

      if (feldNimmt(email, eine.email) && feldNimmt(email, andere.email) && gleicheAdresse(eine.email, andere.email)) {
        ctx.addIssue({
          code: "custom",
          message: "Diese E-Mail-Adresse ist schon bei einer anderen Person eingetragen.",
          path: [zweite, "email"],
        });
      }

      if (feldNimmt(telefon, eine.telefon) && feldNimmt(telefon, andere.telefon) && gleicheNummer(eine.telefon, andere.telefon)) {
        ctx.addIssue({
          code: "custom",
          message: "Diese Telefonnummer ist schon bei einer anderen Person eingetragen.",
          path: [zweite, "telefon"],
        });
      }
    }

    // Parsed rather than compared with `null`: this pass also runs beside a refused claim, which names no seat.
    const gepaart = zugleich.safeParse(kontakte.trainer_ist_zugleich);
    const trainer = kontakte.trainer;
    const sitz = gepaart.success ? kontakte[gepaart.data] : null;

    // The seat the Trainer also holds is filled FROM the Trainer, so a difference is a drifted client
    // rather than something anybody can type — and a banner naming no field cannot explain it.
    if (gepaart.success && trainer !== null && sitz !== null) {
      for (const feld of Object.keys(trainer) as (keyof P)[]) {
        if (!gleicherWert(sitz[feld], trainer[feld])) {
          ctx.addIssue({
            code: "custom",
            message: "Diese Angabe muss mit der des Trainers übereinstimmen.",
            path: [gepaart.data, String(feld)],
          });
        }
      }
    }
  };
}
