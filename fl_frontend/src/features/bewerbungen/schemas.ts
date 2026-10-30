// Redesign: goes with its last importer.
import z from "zod";

import { FLKontaktKenntnisnahmeUmfang, FLKontaktRolle } from "@/core/generated/client/types";
import { SAISON_ID_LENGTH } from "@/features/saisons/constants";
import { FLSpielerKontoEinwilligungPayloadSchema, LinkAntwortTextVersionSchema, WAHL_UNBEKANNT } from "@/features/spieler/schemas";
import {
  EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH,
  KONTAKT_NAME_MAX_LENGTH,
  KONTAKT_NAME_ZU_LANG,
  TEAM_FULL_NAME_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  TEAM_WEBSITE_URL_MAX_LENGTH,
} from "@/features/teams/constants";
import { kontaktePersonenRegeln } from "@/features/teams/kontaktePersonen";
import { FLGruppenNamesSchema, FLSchulformSchema, FLTrainerZugleichSchema, FLTrikotFarbeSchema } from "@/features/teams/schemas";
import {
  ADDRESS_STADTTEIL_MAX_LENGTH,
  CustomDateStringSchema,
  CustomObjectIdStringSchema,
  einzeiligerName,
  ExternalUrlSchema,
  FLAddressPayloadSchema,
  KontaktEmailSchema,
  PersonNameSchema,
  PHONE_REGEX,
} from "@/shared/schemas";
import { getGermanTodayStr } from "@/shared/utils/date";

import {
  alterAusserhalb,
  BEWERBUNG_GRUND_MAX_LENGTH,
  BEWERBUNG_KADER_GROESSE_MAX,
  BEWERBUNG_MIN_ALTER,
  BEWERBUNG_STUFENGROESSE_MAX,
  BEWERBUNG_TOKEN_MAX_LENGTH,
  BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH,
  BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH,
  KUERZEL_LAENGE,
} from "./constants";
import { geburtsdatumSpanne } from "./utils";

import type { FLBewerbungEinwilligungAbgelehnt, FLBewerbungEinwilligungErteilt } from "@/core/generated/client/types";

/**
 * The acceptance's input. No `saison_id`: the application names its own season, so a payload carrying
 * one could only disagree with it.
 */
export const FLAnnehmenBewerbungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  gruppe: FLGruppenNamesSchema,
  // Assigned rather than read off `trikot.wunschfarbe`: a wish is not an assignment.
  trikot_farbe: FLTrikotFarbeSchema.nullable(),
});

/**
 * The decline's input. Its own declaration and never shared with the acceptance's: the two are not
 * inverses, and a payload reaching both would let a value typed for one arrive at the other.
 */
export const FLAblehnenBewerbungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  // Required and non-empty: it is stored on the application AND sent to the people who applied, so a
  // decline with nothing to say is one nobody can act on.
  grund: z
    .string()
    // Trimmed before it is measured, and the trimmed value is what the write carries: „   “ is an
    // empty reason, and a decline is stored and mailed once with no way back.
    .trim()
    .nonempty({ error: "Bitte gib einen Grund für die Absage an." })
    .max(BEWERBUNG_GRUND_MAX_LENGTH, { error: `Der Grund darf höchstens ${String(BEWERBUNG_GRUND_MAX_LENGTH)} Zeichen lang sein.` }),
});

/**
 * The public form submits WHAT was acknowledged and that it was; the server composes the stored record
 * around it, so no visitor can claim an administrative transcription or backdate a Kenntnisnahme.
 */
const FLBewerbungEinwilligungPayloadSchema = z.object({
  // Written by the form from the label the backend runs rather than typed: a label names one
  // frozen wording, so a later rewording never changes what a stored record claims.
  text_version: z
    .string()
    .trim()
    .nonempty({ error: "Die Kenntnisnahme nennt keine Fassung. Lade die Seite neu." })
    .max(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH, {
      error: `Die Fassung darf höchstens ${String(EINWILLIGUNG_TEXT_VERSION_MAX_LENGTH)} Zeichen lang sein.`,
    }),
  // `true` alone, never a boolean: an unticked box is an acknowledgement nobody made, and a payload
  // carrying `false` would record the absence as an answer.
  erteilt: z.literal(true, { error: "Ohne diese Kenntnisnahme können wir die Bewerbung nicht annehmen." }),
});

const KADER_ZU_GROSS = `Bitte gib höchstens ${String(BEWERBUNG_KADER_GROESSE_MAX)} Spieler an.`;

/** The four fields the applicant types for one seat, with the Kenntnisnahme the form gathers for all three at once. */
const FLBewerbungKontaktpersonPayloadSchema = z.object({
  vorname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  nachname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  email: KontaktEmailSchema,
  telefon: z.string().regex(PHONE_REGEX, { error: "Bitte gib eine gültige Telefonnummer ein." }),
  // No birthdate: each contact enters their own on the confirmation page, and the key is undeclared
  // here so the API refuses one an older client still sends rather than storing an unchecked date.
  einwilligung: FLBewerbungEinwilligungPayloadSchema,
});

/**
 * Asked instead of zod's default, which skips a refinement once any check in the block aborts — the consent switch
 * left off is one — so a shared address would wait for a second press.
 */
const SITZE_LESBAR = z.object({ ansprechperson: z.object({}), stellvertretung: z.object({}), trainer: z.object({}) });

/**
 * All three seats are REQUIRED and non-null, unlike the junction's, whose nulls exist for an erasure:
 * an application is what three reachable people submitted.
 */
const FLBewerbungKontaktePayloadSchema = z
  .object({
    trainer: FLBewerbungKontaktpersonPayloadSchema,
    ansprechperson: FLBewerbungKontaktpersonPayloadSchema,
    stellvertretung: FLBewerbungKontaktpersonPayloadSchema,
    // Which OTHER seat the Trainer also holds, or nobody. One nullable field rather than two ticks,
    // which would let a submission claim both at once.
    trainer_ist_zugleich: FLTrainerZugleichSchema.nullable(),
  })
  .superRefine(
    kontaktePersonenRegeln({
      email: FLBewerbungKontaktpersonPayloadSchema.shape.email,
      telefon: FLBewerbungKontaktpersonPayloadSchema.shape.telefon,
      zugleich: FLTrainerZugleichSchema,
    }),
    { when: ({ value }) => SITZE_LESBAR.safeParse(value).success },
  );

/**
 * The shared address with the district REQUIRED. The shared model leaves it optional because a place
 * can genuinely lack one; a Frankfurt school cannot, and the district is what the league plans travel by.
 */
const FLBewerbungAddressPayloadSchema = FLAddressPayloadSchema.extend({
  stadtteil: z
    .string()
    .trim()
    .nonempty({ error: "Bitte gib einen Stadtteil ein." })
    .max(ADDRESS_STADTTEIL_MAX_LENGTH, {
      error: `Der Stadtteil darf höchstens ${String(ADDRESS_STADTTEIL_MAX_LENGTH)} Zeichen lang sein.`,
    }),
});

/**
 * A school the league does not hold yet, in the shape an acceptance would create the club in. The
 * bounds are the club editor's own, read from one place so a school cannot submit what the admin form
 * would refuse.
 */
const FLBewerbungSchulePayloadSchema = z.object({
  team_name: einzeiligerName(
    z
      .string()
      .trim()
      .nonempty({ error: "Bitte gib einen Teamnamen ein." })
      .max(TEAM_NAME_MAX_LENGTH, {
        error: `Der Teamname darf höchstens ${String(TEAM_NAME_MAX_LENGTH)} Zeichen lang sein.`,
      }),
    "Der Teamname",
  ),
  full_name: einzeiligerName(
    z
      .string()
      .trim()
      .nonempty({ error: "Bitte gib den vollständigen Namen der Schule ein." })
      .max(TEAM_FULL_NAME_MAX_LENGTH, {
        error: `Der vollständige Name darf höchstens ${String(TEAM_FULL_NAME_MAX_LENGTH)} Zeichen lang sein.`,
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
  website_url: ExternalUrlSchema.max(TEAM_WEBSITE_URL_MAX_LENGTH, {
    error: `Die Adresse darf höchstens ${String(TEAM_WEBSITE_URL_MAX_LENGTH)} Zeichen lang sein.`,
  }).nullable(),
});

/** What the school already owns, and the colour it would like. */
const FLBewerbungTrikotPayloadSchema = z.object({
  vorhandener_satz: z
    .string()
    .trim()
    .max(BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH, {
      error: `Die Beschreibung darf höchstens ${String(BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH)} Zeichen lang sein.`,
    }),
  wunschfarbe: FLTrikotFarbeSchema,
});

/** The school's own estimate, which nothing later holds it to. */
const FLBewerbungKaderPayloadSchema = z
  .object({
    // `z.number().int()` and never `z.int()`: that spelling answers `null` and `1.5` with one
    // `invalid_type`, so an emptied box and a typed fraction would both draw the empty box's message.
    voraussichtliche_groesse: z
      .number({ error: "Bitte gib an, mit wie vielen Spielern Du ungefähr rechnest." })
      .int({ error: "Ein Kader zählt keine halben Spieler." })
      .min(1, { error: "Ein Kader hat mindestens einen Spieler." })
      .max(BEWERBUNG_KADER_GROESSE_MAX, { error: KADER_ZU_GROSS }),
    // Answered rather than nullable: a blank box leaves the league guessing whether the school means
    // none or has not looked. The refusal names the level the label names, „im Verein“ alone being
    // answered from breadth of membership, not from level.
    gute_spieler: z
      .number({ error: "Bitte gib an, wie viele davon im Verein mindestens Verbandsliga spielen." })
      .int({ error: "Bitte gib eine ganze Zahl an Spielern ein." })
      .nonnegative({ error: "Bitte gib eine Zahl ab 0 ein." })
      .max(BEWERBUNG_KADER_GROESSE_MAX, { error: KADER_ZU_GROSS }),
  })
  // The backend's model validator: a subset cannot outnumber the whole. Equal passes — a school may
  // rate its whole squad. On `gute_spieler`, the box the applicant lowers.
  .refine((kader) => kader.gute_spieler <= kader.voraussichtliche_groesse, {
    error: "Die Anzahl der guten Spieler darf die voraussichtliche Kadergröße nicht überschreiten.",
    path: ["gute_spieler"],
  });

/**
 * The whole submission. `status`, `eingereicht_am` and `entscheidung` are absent by design: the server
 * sets all three, and a client that could name one could submit an application already decided.
 */
export const FLPostBewerbungPayloadSchema = z
  .object({
    saison_id: z.string().trim().length(SAISON_ID_LENGTH, { error: "Diese Bewerbung nennt keine Saison. Lade die Seite neu." }),
    team_id: CustomObjectIdStringSchema.nullable(),
    schule: FLBewerbungSchulePayloadSchema.nullable(),
    kontakte: FLBewerbungKontaktePayloadSchema,
    trikot: FLBewerbungTrikotPayloadSchema,
    kader: FLBewerbungKaderPayloadSchema,
    // `z.number().int()` for `FLBewerbungKaderPayloadSchema`'s reason: `z.int()` would answer an
    // emptied box and a typed fraction alike.
    stufengroesse: z
      // „Abi-Jahrgang" rather than the label's „Stufe": a refusal stands alone, where the hint that
      // settles the label's unit is not beside it to be read.
      .number({ error: "Bitte gib an, wie viele Schülerinnen und Schüler in Deinem Abi-Jahrgang sind." })
      .int({ error: "Bitte gib eine ganze Zahl ein." })
      .min(1, { error: "Bitte gib eine Zahl ab 1 ein." })
      .max(BEWERBUNG_STUFENGROESSE_MAX, { error: `Bitte gib höchstens ${String(BEWERBUNG_STUFENGROESSE_MAX)} an.` }),
    // The one OPTIONAL key on this payload, as the backend's one default: a client that has not asked
    // yet omits it. Line-bounded like `schule.team_name` and for its reason.
    wunschgegner: einzeiligerName(
      z
        .string()
        .trim()
        .max(BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH, {
          error: `Der Wunschgegner darf höchstens ${String(BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH)} Zeichen lang sein.`,
        }),
      "Der Wunschgegner",
    )
      .nullable()
      .optional(),
  })
  .refine((bewerbung) => (bewerbung.team_id === null) !== (bewerbung.schule === null), {
    // On `team_id`, the field the picker renders: the answer „schon dabei oder neu“ is given there,
    // and an issue keyed to the record itself would reach no input at all.
    error: "Bitte wähle eine Schule aus oder trage eine neue ein.",
    path: ["team_id"],
    // Without it zod skips this once any check aborts — an emptied number box is one — and an unpicked school stays
    // unmarked until a second press. Only an object has both keys to read.
    when: ({ value }) => typeof value === "object" && value !== null,
  });

/** The one thing a visitor's body can be wrong about that no input renders: the token their link carried. */
const LINK_UNVOLLSTAENDIG = "Bitte öffne den Link aus Deiner E-Mail erneut.";

/** The link's token. One sentence for the missing token and the over-long one: a visitor typed neither, so the repair is the same link opened again. */
const einwilligungToken = z
  .string()
  .trim()
  .nonempty({ error: LINK_UNVOLLSTAENDIG })
  .max(BEWERBUNG_TOKEN_MAX_LENGTH, { error: LINK_UNVOLLSTAENDIG });

/** The wire names a seat by this closed set; an input naming another is refused before it is sent. */
export const FLKontaktRolleSchema = z.enum(FLKontaktRolle, {
  error: "Diese Rolle gibt es in einer Bewerbung nicht.",
});

/**
 * One endpoint for both answers, told apart by `antwort` as the backend's union is: one person, one
 * press, one token spent. A Widerspruch carries the token alone, its seat storing no person. A
 * confirmation's date is judged against the German day here as the endpoint judges it, so both tiers
 * refuse the same two numbers on the same day.
 */
export const buildEinwilligungAntwortPayloadSchema = (mindestalter: number) =>
  z.discriminatedUnion(
    "antwort",
    [
      z.object({
        antwort: z.literal("erteilt" satisfies FLBewerbungEinwilligungErteilt["antwort"]),
        token: einwilligungToken,
        // Each stage only once the one before it passed: the empty picker is the missing date, and an age is
        // judged of a real date alone.
        geburtsdatum: z
          .string()
          .min(1, { error: "Bitte gib Dein Geburtsdatum ein." })
          .pipe(CustomDateStringSchema)
          .pipe(
            z.string().refine(
              (geburtsdatum) => {
                const { frueheste, spaeteste } = geburtsdatumSpanne(getGermanTodayStr(), mindestalter);
                return frueheste <= geburtsdatum && geburtsdatum <= spaeteste;
              },
              { error: alterAusserhalb(mindestalter) },
            ),
          ),
        whatsapp: z.boolean(),
        // Never optional, as `whatsapp` is not: a page that dropped the switch is refused rather than
        // read as a no.
        medien: z.boolean(),
        // The version this page rendered, never the one the submission stamped: the seat's record has to
        // cite the words the confirming person read, and the two are months apart.
        text_version: LinkAntwortTextVersionSchema,
      }),
      z.object({ antwort: z.literal("abgelehnt" satisfies FLBewerbungEinwilligungAbgelehnt["antwort"]), token: einwilligungToken }),
    ],
    // No control offers another, so a value outside the pair is a drifted client rather than a mistyped
    // answer, and the repair is the reload rather than a choice.
    { error: "Diese Antwort kennen wir nicht. Lade die Seite neu." },
  );

/**
 * The league's floor, which every seat's person clears:
 * `fl_frontend/src/app/api/bestaetigung/kontakt/route.ts` parses a body carrying the token alone, so
 * the seat's own floor is the page's to offer and the endpoint's to refuse.
 */
export const FLBewerbungEinwilligungAntwortPayloadSchema = buildEinwilligungAntwortPayloadSchema(BEWERBUNG_MIN_ALTER);

/** Which application and which of its seats. Both travel in the path, so the request carries no body at all. */
export const FLEinwilligungErneutPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  rolle: FLKontaktRolleSchema,
});

/**
 * A seat holder's two choices from the account page, one declaration the backend publishes for an
 * application's seats and a season row's alike. A pending application's seats take a withdrawal alone,
 * which the backend judges; the page offers no grant there.
 */
export const FLBewerbungPersonEinwilligungPayloadSchema = FLSpielerKontoEinwilligungPayloadSchema.extend({
  // Both choices on every press, so moving one never leaves the other judged by nothing.
  umfang: z.enum(FLKontaktKenntnisnahmeUmfang, { error: WAHL_UNBEKANNT }),
});

/**
 * The one field of a submitted application an administrator may rewrite. `id` and `rolle` travel in
 * the path, as the re-send's do.
 */
export const FLBewerbungKontaktEmailPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  rolle: FLKontaktRolleSchema,
  email: KontaktEmailSchema,
  // The address the page showed on the seat, never one read again in the action: the backend refuses a seat another
  // person took since, which a fresh read would hand the address typed for the one who left (`bewerbung_sitz_anders_besetzt`).
  bisherige_email: KontaktEmailSchema,
});

/**
 * The person seated where a contact person stepped out. The four fields are restated rather than taken
 * off the submission's seat: that one carries the Kenntnisnahme, which this person has given nobody.
 */
export const FLBewerbungKontaktSitzPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  rolle: FLKontaktRolleSchema,
  vorname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  nachname: PersonNameSchema.max(KONTAKT_NAME_MAX_LENGTH, { error: KONTAKT_NAME_ZU_LANG }),
  email: KontaktEmailSchema,
  telefon: z.string().regex(PHONE_REGEX, { error: "Bitte gib eine gültige Telefonnummer ein." }),
  // The label alone and no `erteilt`: it says which wording the new person will be shown, and their
  // own link is what asks them to answer it.
  text_version: FLBewerbungEinwilligungPayloadSchema.shape.text_version,
});
