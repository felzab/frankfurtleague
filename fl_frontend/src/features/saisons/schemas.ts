// Redesign: goes with its last importer.
import z from "zod";

import { FLSpielerStufeSchema } from "@/features/spieler/schemas";
// Its `options` are read at module load below, so a VALUE cycle back into this file reads the set
// before it is initialised rather than merely tangling the graph.
import { FLGruppenNamesSchema } from "@/features/teams/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema } from "@/shared/schemas";

import { MAX_QUALIFIERS, SAISON_ID_LENGTH } from "./constants";

// The old season forms' own judgement of their drafts, in words an administrator reads, before each action sends the
// write through the generated client, which types the body against the write's published contract.

/**
 * **Both sides' goals rather than a margin**, so a season can regulate 3:0, 2:0 or 0:0 as its own
 * competition requires — `fl_backend/app/api/spiele/services.py :: apply_payload_to_spiel` composes
 * the fixture from exactly these two numbers.
 */
const FLSaisonForfeitErgebnisSchema = z.object({
  sieger_tore: z.int({ error: "Bitte gib die Tore für den Sieger ein." }).nonnegative({ error: "Der Sieger bekommt 0 oder mehr Tore." }),
  verlierer_tore: z
    .int({ error: "Bitte gib die Tore für den Verlierer ein." })
    .nonnegative({ error: "Der Verlierer bekommt 0 oder mehr Tore." }),
});

/**
 * German on the TYPE check as well as the bound: an emptied count reaches the draft as `null` and fails
 * `z.int()` first, so a message only on `.positive()` leaves Zod's own English on the field.
 */
const FLSaisonRulesSchema = z.object({
  win_points: z.int({ error: "Bitte gib die Punkte für einen Sieg ein." }).positive({ error: "Ein Sieg bringt mindestens 1 Punkt." }),
  draw_points: z
    .int({ error: "Bitte gib die Punkte für ein Unentschieden ein." })
    .nonnegative({ error: "Ein Unentschieden bringt 0 oder mehr Punkte." }),
  // Required on both sides: a season that never carried it must fail loudly rather than seed a
  // bracket from a number nobody chose.
  qualifiers_per_group: z
    .int({ error: "Bitte gib die Zahl der Qualifikanten pro Gruppe ein." })
    .positive({ error: "Mindestens 1 Team pro Gruppe muss weiterkommen." }),
  // The season runs the first `number_of_groups` of the closed name set, so the set's own size is the
  // ceiling: a literal under it is a group count no season can be created with.
  number_of_groups: z
    .int({ error: "Bitte gib die Zahl der Gruppen ein." })
    .positive({ error: "Eine Saison braucht mindestens 1 Gruppe." })
    .max(FLGruppenNamesSchema.options.length, {
      error: `Es gibt höchstens ${String(FLGruppenNamesSchema.options.length)} Gruppen.`,
    }),
  // The floor stops a group phase that generates no fixture at all; the ceiling bounds one GROUP,
  // where what a whole season may play is `rules_spiele_over_one_read`, weighing every group and the bracket at
  // once.
  teams_per_group: z
    .int({ error: "Bitte gib die Zahl der Teams pro Gruppe ein." })
    .min(2, { error: "Eine Gruppe braucht mindestens 2 Teams, sonst entsteht kein Spiel." })
    .max(16, { error: "Eine Gruppe fasst höchstens 16 Teams." }),
  // Frozen once the season is `past`: the table is ordered from the rules on every read, so a later
  // change rewrites a record.
  tiebreak_order: z.enum(["tordifferenz", "direkter_vergleich"], { error: "Bitte wähle einen Tiebreak aus." }),
  // Enforced at the squad write rather than here: this bounds a season, not this payload.
  max_kadergroesse: z.int({ error: "Bitte gib die maximale Kadergröße ein." }).positive({ error: "Ein Kader fasst mindestens 1 Spieler." }),
  forfeit_ergebnis: FLSaisonForfeitErgebnisSchema,
  // A subset of the league's closed level set, never empty: no level makes every squad entry
  // unfillable.
  erlaubte_stufen: z.array(FLSpielerStufeSchema).min(1, { error: "Bitte wähle mindestens eine Stufe aus." }),
});

/**
 * The two halves recording when the league accepts applications for a season: the span, and the
 * `offen` flag an administrator sets beside it.
 */
const FLSaisonBewerbungSchema = z.object({
  offen: z.boolean(),
  von: CustomDateStringSchema,
  bis: CustomDateStringSchema,
});

/**
 * When a pupil may register. Its own schema rather than a second name for the window above: the two
 * are two decisions, and one shape would widen both at once.
 */
const FLSaisonRegistrierungSchema = z.object({
  offen: z.boolean(),
  von: CustomDateStringSchema,
  bis: CustomDateStringSchema,
});

type Fenster = z.infer<typeof FLSaisonBewerbungSchema> | z.infer<typeof FLSaisonRegistrierungSchema>;

/**
 * Every field naming a season already stored, at one width. `saisonIdField` below MINTS one and
 * carries the pattern and the year range besides.
 */
const saisonIdReference = z
  .string()
  .length(SAISON_ID_LENGTH, { error: `Die Saison-ID besteht aus genau ${String(SAISON_ID_LENGTH)} Zeichen.` });

/**
 * The rules a CREATE judges alone. A patch judges none of the family: each one turns on the step
 * from the stored rules, which the payload does not carry, so the
 * server's 409 is what names them.
 */
const groupCannotOverQualify = {
  error: "Eine Gruppe kann nicht mehr Teams qualifizieren, als sie fasst.",
  path: ["rules", "qualifiers_per_group"],
};

const bracketMustHaveAShape = {
  error: `Die Zahl der Gruppen mal die Qualifikanten pro Gruppe muss eine Zweierpotenz von 2 bis ${String(MAX_QUALIFIERS)} ergeben.`,
  path: ["rules", "qualifiers_per_group"],
};

/** Zero is not a power of two, hence the `n > 0`. */
const isPowerOfTwo = (n: number) => n > 0 && (n & (n - 1)) === 0;

const hasPlayableBracket = (rules: { number_of_groups: number; qualifiers_per_group: number }) => {
  const qualifiers = rules.number_of_groups * rules.qualifiers_per_group;

  return qualifiers >= 2 && qualifiers <= MAX_QUALIFIERS && isPowerOfTwo(qualifiers);
};

const endsAfterItStarts = {
  error: "Das Enddatum darf nicht vor dem Startdatum liegen.",
  path: ["end_date"],
};

// The sentence `the_application_window_ends_after_it_opens` raises, and on `bis` rather than on the
// record: an issue keyed to no field reaches neither the change list's row nor an input.
const windowEndsAfterItOpens = {
  error: "Das Ende darf nicht vor dem Beginn der Bewerbungsfrist liegen.",
  path: ["bewerbung", "bis"],
};

/**
 * Judged apart from the season's own span, as the model validator judges it: a window may
 * legitimately open before the season does. `null` is the season taking no applications, which this
 * rule has nothing to say about.
 */
const windowRunsForwards = (fenster: Fenster | null) => fenster === null || fenster.bis >= fenster.von;

// The sentence `the_registration_window_ends_after_it_opens` raises, worded for its own window:
// one message over both would name neither panel's field.
const registrationWindowEndsAfterItOpens = {
  error: "Das Ende darf nicht vor dem Beginn der Registrierungsfrist liegen.",
  path: ["registrierung", "bis"],
};

/**
 * Shared by create and patch, which replace the season wholesale. **Each window is required and
 * nullable, never optional**: an omitted key would close a window somebody opened.
 */
const saisonPayloadFields = {
  start_date: CustomDateStringSchema,
  end_date: CustomDateStringSchema,
  rules: FLSaisonRulesSchema,
  bewerbung: FLSaisonBewerbungSchema.nullable(),
  registrierung: FLSaisonRegistrierungSchema.nullable(),
};

/**
 * Retyped from `fl_backend/app/api/saisons/schemas.py :: FIRST_SAISON_YEAR`. A literal on both sides, being a fact about this
 * league's own history; the ceiling below is a fact about the calendar and is read from the clock.
 */
const FIRST_SAISON_YEAR = 2026;

// The width is the length bound beside it, on both tiers, so neither states one number twice.
/**
 * The ALPHABET, character for character as `fl_backend/app/api/saisons/schemas.py :: FLPostSaisonPayload`
 * spells it.
 */
const SAISON_ID_PATTERN = /^[0-9]+$/;

/** Read PER PARSE: a ceiling taken once when the module loads pins the year the tab was opened, not the year it is now. */
const newestSaisonYear = () => new Date().getFullYear() + 1;

const yearTheLeagueCanPlay = (value: string) => {
  const year = Number(value);

  return year >= FIRST_SAISON_YEAR && year <= newestSaisonYear();
};

/**
 * The one field that MINTS a season id, so the range binds here and nowhere else: every other id in
 * this module references a season already stored, and narrowing those would refuse a stored row.
 */
const saisonIdField = z
  .string()
  // `abort` on both, as pydantic stops at the first failing constraint: without it one mistyped id
  // raises three sentences at once and the range check is handed a `NaN`.
  .length(SAISON_ID_LENGTH, { error: `Die Saison-ID besteht aus genau ${String(SAISON_ID_LENGTH)} Zeichen, z.B. 2027.`, abort: true })
  .regex(SAISON_ID_PATTERN, { error: "Die Saison-ID ist ein Jahr aus den Ziffern 0 bis 9, z.B. 2027.", abort: true })
  .refine(yearTheLeagueCanPlay, {
    error: () => `Die Saison-ID muss ein Jahr zwischen ${String(FIRST_SAISON_YEAR)} und ${String(newestSaisonYear())} sein.`,
  });

export const FLPostSaisonPayloadSchema = z
  .object({
    // Chosen rather than generated, unlike every other create: `saisons._id` IS the referenced string.
    id: saisonIdField,
    ...saisonPayloadFields,
  })
  .refine((saison) => saison.end_date >= saison.start_date, endsAfterItStarts)
  .refine((saison) => windowRunsForwards(saison.bewerbung), windowEndsAfterItOpens)
  .refine((saison) => windowRunsForwards(saison.registrierung), registrationWindowEndsAfterItOpens)
  .refine((saison) => saison.rules.qualifiers_per_group <= saison.rules.teams_per_group, groupCannotOverQualify)
  .refine((saison) => hasPlayableBracket(saison.rules), bracketMustHaveAShape);

export const FLPatchSaisonPayloadSchema = z
  .object({
    // In the PATH on the wire; here because the editor has to know which season it is saving.
    id: saisonIdReference,
    ...saisonPayloadFields,
  })
  .refine((saison) => saison.end_date >= saison.start_date, endsAfterItStarts)
  .refine((saison) => windowRunsForwards(saison.bewerbung), windowEndsAfterItOpens)
  .refine((saison) => windowRunsForwards(saison.registrierung), registrationWindowEndsAfterItOpens);

/** An id in the path and no request body. */
export const FLActivateSaisonPayloadSchema = z.object({
  id: saisonIdReference,
});

/**
 * The three rules a season's fixture list is a function of. **All three or none**: the draw is one
 * function of the whole shape, so half of it would leave the rest on a season that stopped matching.
 * Picked from the rules, so each bound is stated once.
 */
const FLSpielplanShapeSchema = FLSaisonRulesSchema.pick({
  number_of_groups: true,
  teams_per_group: true,
  qualifiers_per_group: true,
});

/** An id in the path, plus the replace confirmation and the shape this draw runs from. Both left out is the first draw, which destroys nothing. */
export const FLGenerateSpielplanPayloadSchema = z.object({
  id: saisonIdReference,
  replace: z.boolean().optional(),
  // Nullable as well as optional, mirroring `FLSpielplanShape | None`: either spelling means "draw
  // from the season's stored numbers", which is what `rules_shape_after_spielplan` freezes every other route out of.
  shape: FLSpielplanShapeSchema.nullable().optional(),
});

/** An id in the path and no request body. */
export const FLUndrawSpielplanPayloadSchema = z.object({
  id: saisonIdReference,
});

/**
 * **Neither side carries a group**: the backend reads the two junction rows inside the transaction, so
 * a form built against a season that has since moved cannot write a group nobody stands in.
 */
export const FLSwapGruppenPayloadSchema = z.object({
  saison_id: saisonIdReference,
  team1_id: CustomObjectIdStringSchema,
  team2_id: CustomObjectIdStringSchema,
});
