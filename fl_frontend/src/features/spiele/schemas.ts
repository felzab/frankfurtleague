import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLDisqualifikationSchema, FLGruppenNamesSchema } from "@/features/teams/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, CustomTimeStringSchema } from "@/shared/schemas";

import { FLSaisonPhaseSchema } from "../saisons/schemas";

export const FLSpielStatusSchema = z.enum(["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"], { error: "FLSpielStatus is invalid" });
export type FLSpielStatus = z.infer<typeof FLSpielStatusSchema>;

/**
 * Nothing joined belongs here: the backend writes this payload back wholesale, so a field added to
 * it is persisted into the match on the next edit. `FLSpielTeamFieldJoinedSchema` is the read shape.
 */
export const FLSpielTeamFieldSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  tore: z.int().nonnegative().nullable(),
  shorthand: z.string().length(2),
});
export type FLSpielTeamField = z.infer<typeof FLSpielTeamFieldSchema>;

/**
 * Joined per request from `saison_teams`, so no copy of a disqualification can go stale. The whole
 * record rather than a boolean: `null` also covers a team with no junction row for the season.
 */
export const FLSpielTeamFieldJoinedSchema = FLSpielTeamFieldSchema.extend({
  disqualifikation: FLDisqualifikationSchema.nullable(),
});
export type FLSpielTeamFieldJoined = z.infer<typeof FLSpielTeamFieldJoinedSchema>;

export const FLSpielOrtFieldSchema = z.object({
  spielort_id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  maps_link: z.string().nonempty(),
  // The message goes on the TYPE check: the reachable failure is a cleared field arriving as
  // `null`, since every one of these inputs carries `minValue={0}`.
  mietpreis: z.int({ error: "Bitte gib einen Mietpreis ein." }).nonnegative({ error: "Der Mietpreis darf nicht negativ sein." }),
});
export type FLSpielOrtField = z.infer<typeof FLSpielOrtFieldSchema>;

export const FLSpielSchiedsrichterFieldSchema = z.object({
  schiedsrichter_id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  payment: z.int({ error: "Bitte gib eine Entschädigung ein." }).nonnegative({ error: "Die Entschädigung darf nicht negativ sein." }),
});
export type FLSpielSchiedsrichterField = z.infer<typeof FLSpielSchiedsrichterFieldSchema>;

/**
 * An emptied currency field is `null` while the admin types and must not become 0. The strict
 * schemas above still reject `null`, so it fails with a message rather than saving a wrong number.
 */
export type FLSpielOrtFieldDraft = Omit<FLSpielOrtField, "mietpreis"> & { mietpreis: number | null };
export type FLSpielSchiedsrichterFieldDraft = Omit<FLSpielSchiedsrichterField, "payment"> & { payment: number | null };

/** `null` until entered: `0` is a real value here, since a side can miss every kick. */
export type FLSpielElfmeterschiessenDraft = { team1: number | null; team2: number | null };

/**
 * `z.discriminatedUnion` rather than `z.union`, so a malformed source reports the variant's own
 * field errors instead of a union-wide "no match". The discriminator names a shape and is English;
 * its values are competition vocabulary, German.
 */
export const FLSpielQuelleGruppeSchema = z.object({
  type: z.literal("gruppe"),
  gruppe: FLGruppenNamesSchema,
  // On the TYPE check as `mietpreis`'s is: an unpicked placing drafts as `NaN`, which fails
  // `z.int()` before `.positive()` runs.
  platz: z.int({ error: "Bitte wähle einen Platz aus." }).positive({ error: "Der Platz muss mindestens 1 sein." }),
});
export type FLSpielQuelleGruppe = z.infer<typeof FLSpielQuelleGruppeSchema>;

export const FLSpielQuelleSpielSchema = z.object({
  type: z.literal("spiel"),
  spiel_nr: z.int({ error: "Bitte wähle ein Spiel aus." }).positive({ error: "Die Spielnummer muss mindestens 1 sein." }),
  ausgang: z.enum(["sieger", "verlierer"]),
});
export type FLSpielQuelleSpiel = z.infer<typeof FLSpielQuelleSpielSchema>;

export const FLSpielQuelleSchema = z.discriminatedUnion("type", [FLSpielQuelleGruppeSchema, FLSpielQuelleSpielSchema]);
export type FLSpielQuelle = z.infer<typeof FLSpielQuelleSchema>;

/**
 * Kept out of `ergebnis`: both ends parse that string for win/draw/loss and a third number reads as
 * malformed. The counts are not goals — the bracket takes a winner from them, the table the draw.
 * The winner is derived, never stored.
 */
export const FLSpielElfmeterschiessenSchema = z
  .object({
    // On the TYPE check: an emptied NumberField arrives as `NaN`, failing `z.int()` first.
    team1: z.int({ error: "Bitte gib die Treffer von Team 1 ein." }).nonnegative({ error: "Die Treffer dürfen nicht negativ sein." }),
    team2: z.int({ error: "Bitte gib die Treffer von Team 2 ein." }).nonnegative({ error: "Die Treffer dürfen nicht negativ sein." }),
  })
  // Mirrors the model validator: a level shoot-out names nobody, leaving a filled-in record that
  // implies a winner the fixture does not have.
  .refine((schiessen) => schiessen.team1 !== schiessen.team2, {
    error: "Ein Elfmeterschießen kann nicht unentschieden enden.",
    path: ["team2"],
  });
export type FLSpielElfmeterschiessen = z.infer<typeof FLSpielElfmeterschiessenSchema>;

export const FLSpielSchema = z.object({
  id: CustomObjectIdStringSchema,
  spieltag_id: CustomObjectIdStringSchema,

  // The JOINED side, because every response carrying matches serves it. `null` while the occupant
  // is unknown.
  team1: FLSpielTeamFieldJoinedSchema.nullable(),
  team2: FLSpielTeamFieldJoinedSchema.nullable(),

  // A sibling rather than a key inside the field above, because it survives the team arriving.
  // `null` means the slot is the admin's — clearing it is the one way out of automatic upkeep.
  team1_quelle: FLSpielQuelleSchema.nullable(),
  team2_quelle: FLSpielQuelleSchema.nullable(),

  datum: CustomDateStringSchema.nullable(),
  uhrzeit: CustomTimeStringSchema.nullable(),

  ort: FLSpielOrtFieldSchema.nullable(),
  schiedsrichter: FLSpielSchiedsrichterFieldSchema.nullable(),

  // Not free text: `computeErgebnisFor` matches this pattern for W/D/L, and a malformed "3"
  // silently rendered as a loss for both teams.
  ergebnis: z
    .string()
    .regex(/^[0-9]+:[0-9]+$/, "Ergebnis muss die Form 'Tore:Tore' haben, z. B. '3:1'")
    .nullable(),

  elfmeterschiessen: FLSpielElfmeterschiessenSchema.nullable(),

  spiel_nr: z.int().positive(),
  is_canceled: z.boolean(),
  saison_phase: FLSaisonPhaseSchema,
  // Declared because zod's default strip mode discards an undeclared field silently, which is how
  // the patch action once lost the season id its granular cache tag needs.
  saison_id: z.string().length(4),

  // Nullable but never absent: a stored document may lack the key, but the backend fills its
  // default and serializes it on every response.
  notiz: z.string().nullable(),
});
export type FLSpiel = z.infer<typeof FLSpielSchema>;

/**
 * No schema, because nothing parses this. Use it wherever a joined `disqualifikation` is neither
 * read nor available: asking for it there makes a caller invent one, and an invented one is a wrong
 * answer rather than a missing one.
 */
export type FLSpielWithStoredSides = Omit<FLSpiel, "team1" | "team2"> & {
  team1: FLSpielTeamField | null;
  team2: FLSpielTeamField | null;
};

/**
 * The read counterpart to `FLPatchSpielDataPayloadDraft`: a cleared money field is `null` while the
 * admin types, and declaring otherwise takes a cast that type-checks while the value travels
 * (`docs/frontend/spec.md` I33).
 */
export type FLSpielWithDraftFields = Omit<FLSpielWithStoredSides, "ort" | "schiedsrichter"> & {
  ort: FLSpielOrtFieldDraft | null;
  schiedsrichter: FLSpielSchiedsrichterFieldDraft | null;
};

export const FLSpieleListResponseSchema = BaseAPIResponseSchema.extend({
  spiele: z.array(FLSpielSchema),
});
export type FLSpieleListResponse = z.infer<typeof FLSpieleListResponseSchema>;

/**
 * The edit page is addressed by match id alone, so this read is what tells it which season's lookup
 * lists to load — a list read cannot, needing that same season to filter by.
 */
export const FLSpieleSingleResponseSchema = BaseAPIResponseSchema.extend({
  spiel: FLSpielSchema,
});
export type FLSpieleSingleResponse = z.infer<typeof FLSpieleSingleResponseSchema>;

/**
 * Composed from the field schemas above rather than redeclared, so the write shape cannot drift
 * from the read shape. The composition is intra-slice: this write path is not `admin`'s.
 */
export const FLPatchSpielDataPayloadSchema = z.object({
  datum: CustomDateStringSchema.nullable(),
  uhrzeit: CustomTimeStringSchema.nullable(),

  ort: FLSpielOrtFieldSchema.nullable(),
  schiedsrichter: FLSpielSchiedsrichterFieldSchema.nullable(),

  // The stored side, never the joined one: this payload is written back wholesale, so sending a
  // per-request `disqualifikation` would persist it onto the match document.
  team1: FLSpielTeamFieldSchema.nullable(),
  team2: FLSpielTeamFieldSchema.nullable(),

  // Present because `$set` overwrites what the request omits: leaving these off would erase a
  // bracket's wiring on the first edit.
  team1_quelle: FLSpielQuelleSchema.nullable(),
  team2_quelle: FLSpielQuelleSchema.nullable(),

  // The same `$set` reason: omitting it would retract a shoot-out on the first kick-off edit.
  elfmeterschiessen: FLSpielElfmeterschiessenSchema.nullable(),

  // The same `$set` reason. An emptied textarea submits "", which the backend coerces to null.
  notiz: z.string().nullable(),

  spiel_id: CustomObjectIdStringSchema,
  is_canceled: z.boolean(),
});

export type FLPatchSpielDataPayload = z.infer<typeof FLPatchSpielDataPayloadSchema>;

/**
 * What `buildPayload` returns, and why it needs no cast: a cast would launder the money and
 * shoot-out fields into a shape forbidding `null`, so an empty field blocks the save with a message
 * nothing rendered (`docs/frontend/spec.md` I33).
 */
export type FLPatchSpielDataPayloadDraft = Omit<FLPatchSpielDataPayload, "ort" | "schiedsrichter" | "elfmeterschiessen"> & {
  ort: FLSpielOrtFieldDraft | null;
  schiedsrichter: FLSpielSchiedsrichterFieldDraft | null;
  elfmeterschiessen: FLSpielElfmeterschiessenDraft | null;
};

/**
 * `gruppe_too_small` is a typo and the slot keeps what it holds; `tie_unresolved` the tiebreak chain
 * cannot settle, so the slot IS emptied and needs a person. A group still being played is in
 * neither: an undecided placing is not one to show an admin.
 */
export const FLBracketFaultGruppeSchema = z.object({
  reason: z.enum(["gruppe_too_small", "tie_unresolved"]),
  spiel_id: CustomObjectIdStringSchema,
  spiel_nr: z.int().positive(),
  gruppe: FLGruppenNamesSchema,
  platz: z.int().positive(),
});
export type FLBracketFaultGruppe = z.infer<typeof FLBracketFaultGruppeSchema>;

/**
 * `quelle_spiel_nr` is the number to correct. A cycle is reported on every fixture the loop reaches,
 * none of them being derivable.
 */
export const FLBracketFaultQuelleSchema = z.object({
  reason: z.enum(["spiel_missing", "reference_cycle"]),
  spiel_id: CustomObjectIdStringSchema,
  spiel_nr: z.int().positive(),
  quelle_spiel_nr: z.int().positive(),
});
export type FLBracketFaultQuelle = z.infer<typeof FLBracketFaultQuelleSchema>;

/** One fixture whose two references resolve to the same club, so it would be a team against itself. */
export const FLBracketFaultSpielSchema = z.object({
  reason: z.literal("same_team"),
  spiel_id: CustomObjectIdStringSchema,
  spiel_nr: z.int().positive(),
});
export type FLBracketFaultSpiel = z.infer<typeof FLBracketFaultSpielSchema>;

/**
 * **The one fault not about the bracket**, and the only one reaching a group-phase fixture. A match
 * played BEFORE the effective day stands; an undated one is reported, nothing showing it in time.
 * Nothing is emptied — the remedy is a competition call.
 */
export const FLBracketFaultOccupantSchema = z.object({
  reason: z.literal("disqualified_occupant"),
  spiel_id: CustomObjectIdStringSchema,
  spiel_nr: z.int().positive(),
  side: z.enum(["team1", "team2"]),
  team_id: CustomObjectIdStringSchema,
  team_name: z.string().nonempty(),
  disqualifiziert_seit: CustomDateStringSchema,
  spiel_datum: CustomDateStringSchema.nullable(),
});
export type FLBracketFaultOccupant = z.infer<typeof FLBracketFaultOccupantSchema>;

/**
 * `discriminatedUnion` rather than a flat object of optional fields: each variant carries exactly
 * its own fault's fields, so nobody has to know which combinations mean anything.
 */
export const FLBracketFaultSchema = z.discriminatedUnion("reason", [
  FLBracketFaultGruppeSchema,
  FLBracketFaultQuelleSchema,
  FLBracketFaultSpielSchema,
  FLBracketFaultOccupantSchema,
]);
export type FLBracketFault = z.infer<typeof FLBracketFaultSchema>;

/**
 * A slot filling from empty costs nothing; one whose occupant changed under a recorded scoreline
 * loses it in the same transaction. Both voided fields are `null` on the harmless case, so "was
 * anything destroyed" is a null check.
 */
export const FLSpielAdvancementSchema = z.object({
  spiel_nr: z.int().positive(),
  voided_ergebnis: z
    .string()
    .regex(/^[0-9]+:[0-9]+$/, "Ergebnis muss die Form 'Tore:Tore' haben, z. B. '3:1'")
    .nullable(),
  voided_elfmeterschiessen: FLSpielElfmeterschiessenSchema.nullable(),
});
export type FLSpielAdvancement = z.infer<typeof FLSpielAdvancementSchema>;

/**
 * A team plays at most one match per matchday, so fielding it here takes it out of there and that
 * fixture loses its result. Only a side the admin owns moves this way; one carrying a `quelle` is
 * refused, emptying it being undone by the next resolution.
 */
export const FLSpielReleasedSideSchema = z.object({
  spiel_nr: z.int().positive(),
  side: z.enum(["team1", "team2"]),
  team_name: z.string().nonempty(),
  voided_ergebnis: z
    .string()
    .regex(/^[0-9]+:[0-9]+$/, "Ergebnis muss die Form 'Tore:Tore' haben, z. B. '3:1'")
    .nullable(),
  voided_elfmeterschiessen: FLSpielElfmeterschiessenSchema.nullable(),
});
export type FLSpielReleasedSide = z.infer<typeof FLSpielReleasedSideSchema>;

/**
 * **`dry_run=true` answers with this same shape**, one schema being what stops a preview parsing
 * differently to the save it previews. **Declared rather than left to `BaseAPIResponseSchema`**,
 * since `strip` drops an undeclared key silently.
 */
export const FLPatchSpielDataResponseSchema = BaseAPIResponseSchema.extend({
  // Not `.optional()`: `default_factory` puts these outside the published `required` list, but
  // every declared property is on the wire.
  advanced_to: z.array(FLSpielAdvancementSchema),
  released_sides: z.array(FLSpielReleasedSideSchema),
  bracket_faults: z.array(FLBracketFaultSchema),
});

export type FLPatchSpielDataResponse = z.infer<typeof FLPatchSpielDataResponseSchema>;

/**
 * `spiele` carries the filter's matches plus every match a fault names, so the client always holds
 * the document behind one. A fault joins by `spiel_id`, never `spiel_nr`, which repeats across the
 * seasons this route spans.
 */
export const FLSpieleActionRequiredResponseSchema = BaseAPIResponseSchema.extend({
  spiele: z.array(FLSpielSchema),
  bracket_faults: z.array(FLBracketFaultSchema),
});

export type FLSpieleActionRequiredResponse = z.infer<typeof FLSpieleActionRequiredResponseSchema>;
