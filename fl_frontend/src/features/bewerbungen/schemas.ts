import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH } from "@/features/teams/constants";
import {
  FLGruppenNamesSchema,
  FLSaisonTeamKontakteSchema,
  FLSchulformSchema,
  FLTrainerZugleichSchema,
  FLTrikotFarbeSchema,
} from "@/features/teams/schemas";
import {
  ADDRESS_STADTTEIL_MAX_LENGTH,
  CustomDateStringSchema,
  CustomObjectIdStringSchema,
  ExternalUrlSchema,
  FLAddressPayloadSchema,
  FLAddressSchema,
  KONTAKT_EMAIL_MAX_LENGTH,
  PersonNameSchema,
  PHONE_REGEX,
} from "@/shared/schemas";
import { getGermanTodayStr } from "@/shared/utils/date";

import {
  BEWERBUNG_FULL_NAME_MAX_LENGTH,
  BEWERBUNG_GRUND_MAX_LENGTH,
  BEWERBUNG_KADER_GROESSE_MAX,
  BEWERBUNG_KONTAKT_NAME_MAX_LENGTH,
  BEWERBUNG_MAX_ALTER,
  BEWERBUNG_MIN_ALTER,
  BEWERBUNG_TEAM_NAME_MAX_LENGTH,
  BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH,
  BEWERBUNG_WEBSITE_URL_MAX_LENGTH,
  KUERZEL_LAENGE,
} from "./constants";
import { geburtsdatumSpanne } from "./utils";

/**
 * Mirrors `FLBewerbungStatus`. `eingereicht` is the only state a submission arrives in; the other two
 * are the triage's, and the two triage endpoints are the only writers of either.
 */
export const FLBewerbungStatusSchema = z.enum(["eingereicht", "angenommen", "abgelehnt"]);
export type FLBewerbungStatus = z.infer<typeof FLBewerbungStatusSchema>;

/**
 * Mirrors `FLBewerbungSchule` — the club a new school proposes, in the shape acceptance creates it in.
 * Null on an application that picked an existing club.
 */
export const FLBewerbungSchuleSchema = z.object({
  // The club's SHORT name beside `full_name`, not the school's own — the backend model says why it
  // is spelled `team_name` inside a block called `schule`.
  team_name: z.string().nonempty(),
  full_name: z.string().nonempty(),
  shorthand: z.string(),
  schulform: FLSchulformSchema.nullable(),
  address: FLAddressSchema,
  // A plain string, never `ExternalUrlSchema`: the API serves a stored value unchecked, and refusing
  // one on read fails the whole list over the row an administrator needs in order to decline it.
  // Nullable because a school may name no website at all.
  website_url: z.string().nullable(),
});
export type FLBewerbungSchule = z.infer<typeof FLBewerbungSchuleSchema>;

/**
 * Mirrors `FLBewerbungTrikot` — what the school already owns, and the colour it would like. Never
 * copied onto the team: the assignment is the administrator's, and two schools may wish for one colour.
 */
export const FLBewerbungTrikotSchema = z.object({
  vorhandener_satz: z.string(),
  wunschfarbe: FLTrikotFarbeSchema.nullable(),
});
export type FLBewerbungTrikot = z.infer<typeof FLBewerbungTrikotSchema>;

/**
 * Mirrors `FLBewerbungKader` — the school's own estimate of its squad. Unbounded on read, as every
 * read field here is: a stored value outside a bound must still parse, or one row fails a whole list.
 */
export const FLBewerbungKaderSchema = z.object({
  voraussichtliche_groesse: z.int(),
  gute_spieler: z.int(),
});
export type FLBewerbungKader = z.infer<typeof FLBewerbungKaderSchema>;

/** Mirrors `FLBewerbungEntscheidung` — who decided, when, and on a decline why. */
export const FLBewerbungEntscheidungSchema = z.object({
  getroffen_am: CustomDateStringSchema,
  von: z.string(),
  // Null on an acceptance: what an acceptance did is the club and the junction row it wrote.
  grund: z.string().nullable(),
});
export type FLBewerbungEntscheidung = z.infer<typeof FLBewerbungEntscheidungSchema>;

/**
 * Mirrors `FLBewerbung` — one school's application to play one season, as it is stored. The submission
 * is never rewritten: only `status`, `entscheidung` and `team_id` move, through the two triage endpoints.
 */
export const FLBewerbungSchema = z.object({
  id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  eingereicht_am: CustomDateStringSchema,
  status: FLBewerbungStatusSchema,
  // The club the applicant PICKED, null where they proposed a new school. Acceptance writes the
  // created club's id back here, so a decided application always names one.
  team_id: CustomObjectIdStringSchema.nullable(),
  schule: FLBewerbungSchuleSchema.nullable(),
  // The junction's own three seats, imported rather than restated: an application's three people
  // BECOME the junction's three at acceptance, which is how the backend declares it too.
  kontakte: FLSaisonTeamKontakteSchema,
  trikot: FLBewerbungTrikotSchema,
  kader: FLBewerbungKaderSchema,
  entscheidung: FLBewerbungEntscheidungSchema.nullable(),
});
export type FLBewerbung = z.infer<typeof FLBewerbungSchema>;

/**
 * Mirrors `FLAnnehmenBewerbungPayload`. No `saison_id`: the application names its own season, so a
 * payload carrying one could only disagree with it.
 */
export const FLAnnehmenBewerbungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  gruppe: FLGruppenNamesSchema,
  // Assigned rather than read off `trikot.wunschfarbe`: a wish is not an assignment.
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
});
export type FLAnnehmenBewerbungPayload = z.infer<typeof FLAnnehmenBewerbungPayloadSchema>;

/**
 * Mirrors `FLAblehnenBewerbungPayload`. Its own declaration and never shared with the acceptance's:
 * the two are not inverses, and a payload reaching both would let a value typed for one arrive at
 * the other.
 */
export const FLAblehnenBewerbungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  // Required and non-empty: it is stored on the application AND sent to the people who applied, so a
  // decline with nothing to say is one nobody can act on. German because the panel binds it to its input.
  grund: z
    .string()
    // Trimmed before it is measured, and the trimmed value is what the write carries: „   “ is an
    // empty reason, and a decline is stored and mailed once with no way back.
    .trim()
    .nonempty({ error: "Bitte gib einen Grund für die Absage an." })
    .max(BEWERBUNG_GRUND_MAX_LENGTH, { error: `Der Grund darf höchstens ${String(BEWERBUNG_GRUND_MAX_LENGTH)} Zeichen lang sein.` }),
});
export type FLAblehnenBewerbungPayload = z.infer<typeof FLAblehnenBewerbungPayloadSchema>;

export const FLBewerbungenListResponseSchema = BaseAPIResponseSchema.extend({
  bewerbungen: z.array(FLBewerbungSchema),
  /** False where the endpoint's cap cut the answer short, which every count taken over the rows is then blind to. */
  vollstaendig: z.boolean(),
});
export type FLBewerbungenListResponse = z.infer<typeof FLBewerbungenListResponseSchema>;

export const FLBewerbungSingleResponseSchema = BaseAPIResponseSchema.extend({
  bewerbung: FLBewerbungSchema,
});
export type FLBewerbungSingleResponse = z.infer<typeof FLBewerbungSingleResponseSchema>;

/** Mirrors `FLAnnehmenBewerbungResponse` — the application as the acceptance left it, plus what it wrote beyond it. */
export const FLAnnehmenBewerbungResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLBewerbungSchema,
  // The club now standing in the season: the one the applicant picked, or the one this acceptance
  // created. Echoed because a created club has an id the caller has no other way to learn.
  team_id: CustomObjectIdStringSchema,
  // Whether this acceptance created that club. Comparing the application's own `team_id` cannot tell
  // the two apart — acceptance writes the created id back onto it.
  created_team: z.boolean(),
  saison_id: z.string(),
  gruppe: FLGruppenNamesSchema,
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
});
export type FLAnnehmenBewerbungResponse = z.infer<typeof FLAnnehmenBewerbungResponseSchema>;

export const FLAblehnenBewerbungResponseSchema = BaseAPIResponseSchema.extend({
  updated_document: FLBewerbungSchema,
});
export type FLAblehnenBewerbungResponse = z.infer<typeof FLAblehnenBewerbungResponseSchema>;

/**
 * Mirrors `FLBewerbungFensterResponse` — one season's window and nothing else of it.
 * `docs/backend/spec.md :: I47` withholds a `future` season from the base tier, and a season taking
 * applications IS one.
 */
export const FLBewerbungFensterResponseSchema = BaseAPIResponseSchema.extend({
  saison_id: z.string(),
  offen: z.boolean(),
  von: CustomDateStringSchema,
  bis: CustomDateStringSchema,
  // The whole judgement — `offen` AND today inside the span — computed server-side, so no client
  // re-derives it against a clock the server does not share.
  laeuft: z.boolean(),
});
export type FLBewerbungFensterResponse = z.infer<typeof FLBewerbungFensterResponseSchema>;

/**
 * Mirrors `FLBewerbungSchuleOption` — one club as the public form offers it, and nothing more.
 * Declared from nothing rather than picked off `FLTeamSchema`: an anonymous visitor reads this
 * (`READ-BEWERBUNG-001`).
 */
export const FLBewerbungSchuleOptionSchema = z.object({
  id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
});
export type FLBewerbungSchuleOption = z.infer<typeof FLBewerbungSchuleOptionSchema>;

/** Mirrors `FLBewerbungSchulenResponse` — the clubs a school may pick itself out of, name-sorted. */
export const FLBewerbungSchulenResponseSchema = BaseAPIResponseSchema.extend({
  schulen: z.array(FLBewerbungSchuleOptionSchema),
});
export type FLBewerbungSchulenResponse = z.infer<typeof FLBewerbungSchulenResponseSchema>;

/**
 * Mirrors `FLBewerbungKuerzelResponse` — ONE neutral answer. It never separates an active club from
 * a retired one and names no club: the check is open to anybody, and either would be a read of the
 * league's roster nobody asked it for.
 */
export const FLBewerbungKuerzelResponseSchema = BaseAPIResponseSchema.extend({
  shorthand: z.string(),
  vergeben: z.boolean(),
});
export type FLBewerbungKuerzelResponse = z.infer<typeof FLBewerbungKuerzelResponseSchema>;

/** Mirrors `FLPostBewerbungResponse`. Nothing of the submission is echoed back into the page. */
export const FLPostBewerbungResponseSchema = BaseAPIResponseSchema.extend({
  created_id: CustomObjectIdStringSchema,
  saison_id: z.string(),
  eingereicht_am: CustomDateStringSchema,
});
export type FLPostBewerbungResponse = z.infer<typeof FLPostBewerbungResponseSchema>;

/**
 * Mirrors `FLBewerbungEinwilligungPayload`. The public form submits WHAT was agreed to and that it
 * was; the server composes the stored record around it, so no visitor can claim an administrative
 * transcription or backdate a consent.
 */
export const FLBewerbungEinwilligungPayloadSchema = z.object({
  // Written by the form from `LIGA_EINWILLIGUNG` rather than typed: the wording lives in the
  // frontend and is versioned there, so a later rewording never changes what a stored record claims.
  text_version: z
    .string()
    .trim()
    .nonempty({ error: "Die Einwilligung nennt keine Fassung. Lade die Seite neu." })
    .max(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, {
      error: `Die Fassung darf höchstens ${String(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)} Zeichen lang sein.`,
    }),
  // `true` alone, never a boolean: an unticked box is a consent nobody gave, and a payload carrying
  // `false` would record the absence as an answer.
  erteilt: z.literal(true, { error: "Ohne Einwilligung dürfen wir die Daten dieser Person nicht speichern." }),
});
export type FLBewerbungEinwilligungPayload = z.infer<typeof FLBewerbungEinwilligungPayloadSchema>;

/** Both name boxes and both count boxes share a ceiling, so each sentence is written once. */
const NAME_ZU_LANG = `Der Name darf höchstens ${String(BEWERBUNG_KONTAKT_NAME_MAX_LENGTH)} Zeichen lang sein.`;
const KADER_ZU_GROSS = `Bitte gib höchstens ${String(BEWERBUNG_KADER_GROESSE_MAX)} Spieler an.`;

/**
 * Mirrors `FLBewerbungKontaktpersonPayload` — `FLKontaktpersonPayload` with the agreement the public
 * form gathers and the one date bound on this payload alone.
 */
export const FLBewerbungKontaktpersonPayloadSchema = z.object({
  // The alphabet is `PersonNameSchema`'s and the ceiling is this payload's, as the backend spells it.
  vorname: PersonNameSchema.max(BEWERBUNG_KONTAKT_NAME_MAX_LENGTH, { error: NAME_ZU_LANG }),
  nachname: PersonNameSchema.max(BEWERBUNG_KONTAKT_NAME_MAX_LENGTH, { error: NAME_ZU_LANG }),
  email: z
    .email({ error: "Bitte gib eine gültige E-Mail-Adresse ein." })
    .max(KONTAKT_EMAIL_MAX_LENGTH, { error: `Die E-Mail-Adresse darf höchstens ${String(KONTAKT_EMAIL_MAX_LENGTH)} Zeichen lang sein.` }),
  telefon: z.string().regex(PHONE_REGEX, { error: "Bitte gib eine gültige Telefonnummer ein." }),
  // Bounded HERE and on no other date in the application: these three are the people the league
  // deals with, and a birthdate outside this span is a typo rather than a person.
  geburtsdatum: CustomDateStringSchema.refine(
    (value) => {
      const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr());

      return value >= frueheste && value <= spaeteste;
    },
    // Both bounds, because the refine holds both: named for the floor alone, a mistyped year answers
    // a 190-year-old date with „muss mindestens 16 Jahre alt sein“, which is a different fault.
    {
      error:
        `Eine Kontaktperson ist mindestens ${String(BEWERBUNG_MIN_ALTER)} und höchstens ${String(BEWERBUNG_MAX_ALTER)} Jahre alt. ` +
        `Prüfe das Geburtsdatum.`,
    },
  ),
  einwilligung: FLBewerbungEinwilligungPayloadSchema,
});
export type FLBewerbungKontaktpersonPayload = z.infer<typeof FLBewerbungKontaktpersonPayloadSchema>;

/**
 * The pairs of seats that must not be one person, in the order the form shows them. The issue lands
 * on the SECOND of each pair: it is the field the applicant reaches next, and the one to change.
 */
const KONTAKT_PAARE = [
  ["trainer", "ansprechperson"],
  ["trainer", "stellvertretung"],
  ["ansprechperson", "stellvertretung"],
] as const;

/** Compared without case and without surrounding space, as a person retyping their own address writes it. */
const gleicheAdresse = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase() && a.trim() !== "";

// Both spellings of the country code. Neither arm can take the other's value -- `0049…` does not
// start with `49` -- so the order carries nothing.
const TELEFON_LAENDERVORWAHLEN = ["0049", "49"] as const;

/**
 * One spelling per number, mirroring `fl_backend/app/api/bewerbungen/schemas.py :: normalise_telefon`.
 * Compared raw, the form accepts a pair the backend refuses as a 422 that names no field — so the
 * applicant is told to retry what cannot succeed.
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
 * No empty-guard beside `gleicheAdresse`'s: `PHONE_REGEX` admits `().`, which normalises to nothing,
 * and Pydantic refuses two such seats.
 */
const gleicheNummer = (a: string, b: string): boolean => normalisiereTelefon(a) === normalisiereTelefon(b);

// By value, because `einwilligung` is an object and two equal consents are two objects. One level of
// nesting is all a contact block has, and `einwilligung` is flat, so entry-wise comparison is total.
const gleicherWert = (a: unknown, b: unknown): boolean =>
  typeof a === "object" && a !== null && typeof b === "object" && b !== null
    ? JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
    : a === b;

/**
 * Mirrors `FLBewerbungKontaktePayload`. All three seats are REQUIRED and non-null, unlike the
 * junction's, whose nulls exist for an erasure: an application is what three reachable people
 * submitted.
 */
export const FLBewerbungKontaktePayloadSchema = z
  .object({
    trainer: FLBewerbungKontaktpersonPayloadSchema,
    ansprechperson: FLBewerbungKontaktpersonPayloadSchema,
    stellvertretung: FLBewerbungKontaktpersonPayloadSchema,
    // Which OTHER seat the Trainer also holds, or nobody. One nullable field rather than two ticks,
    // which would let a submission claim both at once.
    trainer_ist_zugleich: FLTrainerZugleichSchema.nullable(),
  })
  .superRefine((kontakte, ctx) => {
    for (const [erste, zweite] of KONTAKT_PAARE) {
      // The declared pair IS one person and shares everything by construction. Every other pair is
      // two people the league has to be able to tell apart when one of them stops answering.
      if (erste === "trainer" && zweite === kontakte.trainer_ist_zugleich) continue;

      if (gleicheAdresse(kontakte[erste].email, kontakte[zweite].email)) {
        ctx.addIssue({
          code: "custom",
          message: "Diese E-Mail-Adresse ist schon bei einer anderen Person eingetragen.",
          path: [zweite, "email"],
        });
      }

      if (gleicheNummer(kontakte[erste].telefon, kontakte[zweite].telefon)) {
        ctx.addIssue({
          code: "custom",
          message: "Diese Telefonnummer ist schon bei einer anderen Person eingetragen.",
          path: [zweite, "telefon"],
        });
      }
    }

    // The seat the Trainer also holds is filled FROM the Trainer, so a difference is a drifted client
    // rather than something an applicant can type — and a banner naming no field cannot explain it.
    const zugleich = kontakte.trainer_ist_zugleich;
    if (zugleich !== null) {
      for (const feld of Object.keys(kontakte.trainer) as (keyof FLBewerbungKontaktpersonPayload)[]) {
        if (!gleicherWert(kontakte[zugleich][feld], kontakte.trainer[feld])) {
          ctx.addIssue({
            code: "custom",
            message: "Diese Angabe muss mit der des Trainers übereinstimmen.",
            path: [zugleich, feld],
          });
        }
      }
    }
  });
export type FLBewerbungKontaktePayload = z.infer<typeof FLBewerbungKontaktePayloadSchema>;

/**
 * Mirrors `FLBewerbungAddressPayload` — `FLAddressPayload` with the district REQUIRED. The shared
 * model leaves it optional because a place can genuinely lack one; a Frankfurt school cannot, and
 * the district is what the league plans travel by.
 */
export const FLBewerbungAddressPayloadSchema = FLAddressPayloadSchema.extend({
  stadtteil: z
    .string()
    .trim()
    .nonempty({ error: "Bitte gib einen Stadtteil ein." })
    .max(ADDRESS_STADTTEIL_MAX_LENGTH, {
      error: `Der Stadtteil darf höchstens ${String(ADDRESS_STADTTEIL_MAX_LENGTH)} Zeichen lang sein.`,
    }),
});
export type FLBewerbungAddressPayload = z.infer<typeof FLBewerbungAddressPayloadSchema>;

/**
 * A school's name is one line: `trim` clears a break at either END and leaves the interior one,
 * which is the half that forges a fact in a decision mail (`docs/frontend/spec.md :: I46`).
 */
const einzeiligerName = (schema: z.ZodString, feld: string) =>
  schema.refine((wert) => !/[\r\n]/.test(wert), { error: `${feld} darf keinen Zeilenumbruch enthalten.` });

/**
 * Mirrors `FLBewerbungSchulePayload` — a school the league does not hold yet, in the shape an
 * acceptance would create the club in. The bounds are the club editor's own, read from one place so
 * a school cannot submit what the admin form would refuse.
 */
export const FLBewerbungSchulePayloadSchema = z.object({
  // The club's SHORT name beside `full_name`, which is why it is spelled `team_name` inside a block
  // called `schule`.
  team_name: einzeiligerName(
    z
      .string()
      .trim()
      .nonempty({ error: "Bitte gib einen Teamnamen ein." })
      .max(BEWERBUNG_TEAM_NAME_MAX_LENGTH, {
        error: `Der Teamname darf höchstens ${String(BEWERBUNG_TEAM_NAME_MAX_LENGTH)} Zeichen lang sein.`,
      }),
    "Der Teamname",
  ),
  full_name: einzeiligerName(
    z
      .string()
      .trim()
      .nonempty({ error: "Bitte gib den vollständigen Namen der Schule ein." })
      .max(BEWERBUNG_FULL_NAME_MAX_LENGTH, {
        error: `Der vollständige Name darf höchstens ${String(BEWERBUNG_FULL_NAME_MAX_LENGTH)} Zeichen lang sein.`,
      }),
    "Der vollständige Name",
  ),
  shorthand: z
    .string()
    .trim()
    .length(KUERZEL_LAENGE, { error: `Das Kürzel besteht aus genau ${String(KUERZEL_LAENGE)} Zeichen.` }),
  // Answered, unlike the club editor's: „Keine Angabe“ is a gap an administrator can chase later,
  // and the one person who knows the answer is the applicant filling this box.
  schulform: FLSchulformSchema,
  address: FLBewerbungAddressPayloadSchema,
  // Optional, as it is on the club the acceptance would create: a school without a website is one
  // the league still wants, and the two surfaces may not disagree about that.
  website_url: ExternalUrlSchema.max(BEWERBUNG_WEBSITE_URL_MAX_LENGTH, {
    error: `Die Adresse darf höchstens ${String(BEWERBUNG_WEBSITE_URL_MAX_LENGTH)} Zeichen lang sein.`,
  }).nullable(),
});
export type FLBewerbungSchulePayload = z.infer<typeof FLBewerbungSchulePayloadSchema>;

/** Mirrors `FLBewerbungTrikotPayload` — what the school already owns, and the colour it would like. */
export const FLBewerbungTrikotPayloadSchema = z.object({
  vorhandener_satz: z
    .string()
    .trim()
    .max(BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH, {
      error: `Die Beschreibung darf höchstens ${String(BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH)} Zeichen lang sein.`,
    }),
  // Answered, unlike the stored field this becomes: a wish is one of sixteen colours and the school
  // has one. `FLBewerbungTrikot` stays nullable, where an unanswered older record still reads and
  // where the administrator's assignment is a different field.
  wunschfarbe: FLTrikotFarbeSchema,
});
export type FLBewerbungTrikotPayload = z.infer<typeof FLBewerbungTrikotPayloadSchema>;

/** Mirrors `FLBewerbungKaderPayload` — the school's own estimate, which nothing later holds it to. */
export const FLBewerbungKaderPayloadSchema = z
  .object({
    voraussichtliche_groesse: z
      .int({ error: "Bitte gib an, mit wie vielen Spielern Du ungefähr rechnest." })
      .min(1, { error: "Ein Kader hat mindestens einen Spieler." })
      .max(BEWERBUNG_KADER_GROESSE_MAX, { error: KADER_ZU_GROSS }),
    // Answered rather than nullable: a blank box leaves the league guessing whether the school means
    // none or has not looked. The refusal names the level the label names, „im Verein“ alone being
    // answered from breadth of membership, not from level.
    gute_spieler: z
      .int({ error: "Bitte gib an, wie viele davon im Verein mindestens Verbandsliga spielen." })
      .nonnegative({ error: "Bitte gib eine Zahl ab 0 ein." })
      .max(BEWERBUNG_KADER_GROESSE_MAX, { error: KADER_ZU_GROSS }),
  })
  // Mirrors the model validator: a subset cannot outnumber the whole, and both figures are the school's own
  // estimate. Equal passes — a school may rate its whole squad. On `gute_spieler`, the box the applicant lowers.
  .refine((kader) => kader.gute_spieler <= kader.voraussichtliche_groesse, {
    error: "Die Anzahl der guten Spieler darf die voraussichtliche Kadergröße nicht überschreiten.",
    path: ["gute_spieler"],
  });
export type FLBewerbungKaderPayload = z.infer<typeof FLBewerbungKaderPayloadSchema>;

/**
 * Mirrors `FLPostBewerbungPayload` — the whole submission. `status`, `eingereicht_am` and
 * `entscheidung` are absent by design: the server sets all three, and a client that could name one
 * could submit an application already decided.
 */
export const FLPostBewerbungPayloadSchema = z
  .object({
    saison_id: z.string().trim().length(4, { error: "Diese Bewerbung nennt keine Saison. Lade die Seite neu." }),
    // The club PICKED out of the league's own list, null where the school proposes a new one.
    team_id: CustomObjectIdStringSchema.nullable(),
    schule: FLBewerbungSchulePayloadSchema.nullable(),
    kontakte: FLBewerbungKontaktePayloadSchema,
    trikot: FLBewerbungTrikotPayloadSchema,
    kader: FLBewerbungKaderPayloadSchema,
  })
  .refine((bewerbung) => (bewerbung.team_id === null) !== (bewerbung.schule === null), {
    // On `team_id`, the field the picker renders: the answer „schon dabei oder neu“ is given there,
    // and an issue keyed to the record itself would reach no input at all.
    error: "Bitte wähle eine Schule aus oder trage eine neue ein.",
    path: ["team_id"],
  });
export type FLPostBewerbungPayload = z.infer<typeof FLPostBewerbungPayloadSchema>;
