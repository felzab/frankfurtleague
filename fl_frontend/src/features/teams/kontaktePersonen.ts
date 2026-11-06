import { asSignInIdentifier } from "@/core/emailAddress";

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
 * One address on the sign-in fold, as the API compares two seats: trimmed, and ASCII case alone lowered.
 */
export const gleicheAdresse = (a: string, b: string): boolean => asSignInIdentifier(a) === asSignInIdentifier(b) && a.trim() !== "";

// Both spellings of the country code. Neither arm can take the other's value -- `0049…` does not
// start with `49` -- so the order carries nothing.
const TELEFON_LAENDERVORWAHLEN = ["0049", "49"] as const;

/**
 * One spelling per number, mirroring `fl_backend/app/api/teams/schemas.py :: normalise_phone`.
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

type Person = { email: string; phone: string };
type Sitz = "trainer" | "ansprechperson" | "stellvertretung";

/**
 * The boxes, by the names they post under, holding an address or a number another person of the block holds: the rule
 * above for a form whose fields post, which no schema of its own judges, the backend's refusal naming the block and so
 * no box. The seat the Trainer also holds is that person and is compared with nobody.
 */
export function repeatedContacts(kontakte: Record<Sitz, Person> & { trainer_is_also: Sitz | null }): readonly string[] {
  return KONTAKT_PAARE.flatMap(([erste, zweite]) => {
    if (zweite === "trainer" && erste === kontakte.trainer_is_also) return [];
    const [eine, andere] = [kontakte[erste], kontakte[zweite]];
    return [
      ...(gleicheAdresse(eine.email, andere.email) ? [`kontakte.${zweite}.email`] : []),
      ...(gleicheNummer(eine.phone, andere.phone) ? [`kontakte.${zweite}.phone`] : []),
    ];
  });
}
