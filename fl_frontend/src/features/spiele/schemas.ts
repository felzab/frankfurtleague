import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLAustrittSchema, FLGruppenNamesSchema } from "@/features/teams/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, CustomTimeStringSchema } from "@/shared/schemas";

import { FLSaisonPhaseSchema } from "../saisons/schemas";

export const FLSpielStatusSchema = z.enum(["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"], { error: "FLSpielStatus is invalid" });
export type FLSpielStatus = z.infer<typeof FLSpielStatusSchema>;

/**
 * What happened to a fixture beyond being played, mirroring
 * `fl_backend/app/api/spiele/schemas.py :: FLSonderereignis`. Distinct in kind from `FLSpielStatus`,
 * which is derived, total and about time.
 */
export const FLSonderereignisSchema = z.enum(["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"], {
  error: "FLSonderereignis is invalid",
});
export type FLSonderereignis = z.infer<typeof FLSonderereignisSchema>;

/**
 * One side as the admin PATCH submits it: which club, and what it scored. No name and no shorthand
 * — the season's `saison_teams` row is where a club's name lives, so a copy a client sent could only
 * disagree with it. The server composes both.
 */
export const FLSpielTeamFieldPayloadSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  tore: z.int().nonnegative().nullable(),
});
export type FLSpielTeamFieldPayload = z.infer<typeof FLSpielTeamFieldPayloadSchema>;

/**
 * One side as the document STORES it, and as the editor's draft carries it: the pickers render the
 * club by name. `FLSpielTeamFieldJoinedSchema` is the read shape.
 */
export const FLSpielTeamFieldSchema = FLSpielTeamFieldPayloadSchema.extend({
  name: z.string().nonempty(),
  shorthand: z.string().length(2),
});
export type FLSpielTeamField = z.infer<typeof FLSpielTeamFieldSchema>;

/**
 * Joined per request, so no copy of a club's exit can go stale — and narrowed to the route out:
 * every public surface listing a fixture carries this side, and only a club's own page renders the
 * reason. `null` also covers a team with no junction row.
 */
export const FLSpielTeamFieldJoinedSchema = FLSpielTeamFieldSchema.extend({
  austritt_type: FLAustrittSchema.shape.type.nullable(),
});
export type FLSpielTeamFieldJoined = z.infer<typeof FLSpielTeamFieldJoinedSchema>;

/**
 * The venue as the admin PATCH submits it. `mietpreis` stays on the payload where the name does not:
 * it is THIS fixture's rent rather than a copy of the venue's current default, so dropping it from
 * the wire would rewrite a rent on every save.
 */
export const FLSpielOrtFieldPayloadSchema = z.object({
  spielort_id: CustomObjectIdStringSchema,
  // The message goes on the TYPE check: the reachable failure is a cleared field arriving as
  // `null`, since every one of these inputs carries `minValue={0}`.
  mietpreis: z.int({ error: "Bitte gib einen Mietpreis ein." }).nonnegative({ error: "Der Mietpreis darf nicht negativ sein." }),
});
export type FLSpielOrtFieldPayload = z.infer<typeof FLSpielOrtFieldPayloadSchema>;

/**
 * The venue as a base-tier read serves it: which ground, and where to find it. What one fixture
 * agreed to pay is admin-tier, so it is absent here rather than nullable — a reader holding this
 * shape cannot ask for a figure it was never sent.
 */
export const FLSpielOrtFieldPublicSchema = z.object({
  spielort_id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  maps_link: z.string().nonempty(),
});
export type FLSpielOrtFieldPublic = z.infer<typeof FLSpielOrtFieldPublicSchema>;

/**
 * The venue as the admin editor reads it back. **The served shape is the base and the rent the
 * extension**, mirroring the models: composing a name onto the PAYLOAD is what the backend forbids,
 * so the payload is a sibling rather than an ancestor.
 */
export const FLSpielOrtFieldSchema = FLSpielOrtFieldPublicSchema.extend({
  mietpreis: FLSpielOrtFieldPayloadSchema.shape.mietpreis,
});
export type FLSpielOrtField = z.infer<typeof FLSpielOrtFieldSchema>;

/** The referee as the admin PATCH submits it; `payment` stays on the wire for `mietpreis`' reason. */
export const FLSpielSchiedsrichterFieldPayloadSchema = z.object({
  schiedsrichter_id: CustomObjectIdStringSchema,
  payment: z.int({ error: "Bitte gib eine Entschädigung ein." }).nonnegative({ error: "Die Entschädigung darf nicht negativ sein." }),
});
export type FLSpielSchiedsrichterFieldPayload = z.infer<typeof FLSpielSchiedsrichterFieldPayloadSchema>;

/** The referee as a base-tier read serves it; `payment` is withheld for `mietpreis`' reason. */
export const FLSpielSchiedsrichterFieldPublicSchema = z.object({
  schiedsrichter_id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
});
export type FLSpielSchiedsrichterFieldPublic = z.infer<typeof FLSpielSchiedsrichterFieldPublicSchema>;

/** The referee as the admin editor reads it back, extending the served shape for `FLSpielOrtField`'s reason. */
export const FLSpielSchiedsrichterFieldSchema = FLSpielSchiedsrichterFieldPublicSchema.extend({
  payment: FLSpielSchiedsrichterFieldPayloadSchema.shape.payment,
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

  // The base-tier halves: what a fixture pays for its ground and its referee is admin-tier, and
  // `FLSpielAdminSchema` is where a reader that is entitled to it gets it.
  ort: FLSpielOrtFieldPublicSchema.nullable(),
  schiedsrichter: FLSpielSchiedsrichterFieldPublicSchema.nullable(),

  // Not free text: `computeErgebnisFor` matches this pattern for W/D/L, and a malformed "3"
  // silently rendered as a loss for both teams.
  ergebnis: z
    .string()
    .regex(/^[0-9]+:[0-9]+$/, "Ergebnis muss die Form 'Tore:Tore' haben, z. B. '3:1'")
    .nullable(),

  elfmeterschiessen: FLSpielElfmeterschiessenSchema.nullable(),

  spiel_nr: z.int().positive(),

  // `null` is the ordinary fixture, played or not yet, so no read site has to spell one out.
  sonderereignis: FLSonderereignisSchema.nullable(),
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
 * The same fixture for the admin editor, carrying the two figures the base tier withholds. A second
 * schema rather than one with optional money: a shape that follows the caller's credential is one no
 * parse can hold both ends of.
 */
export const FLSpielAdminSchema = FLSpielSchema.extend({
  ort: FLSpielOrtFieldSchema.nullable(),
  schiedsrichter: FLSpielSchiedsrichterFieldSchema.nullable(),
});
export type FLSpielAdmin = z.infer<typeof FLSpielAdminSchema>;

/**
 * No schema, because nothing parses this. Use it wherever a joined `austritt` is neither read nor
 * available: asking for it there makes a caller invent one, and an invented one is a wrong answer
 * rather than a missing one.
 */
export type FLSpielWithStoredSides = Omit<FLSpiel, "team1" | "team2"> & {
  team1: FLSpielTeamField | null;
  team2: FLSpielTeamField | null;
};

/**
 * One fixture's ground and referee as the admin tier serves them. A base-tier read carries neither
 * figure, so a fixture the editor never opened reaches a write payload only with this supplied
 * beside it.
 */
export type FLSpielBooking = Pick<FLSpielAdmin, "ort" | "schiedsrichter">;

/**
 * The read counterpart to `FLPatchSpielDataPayloadDraft`, and admin-tier: a cleared money field is
 * `null` while the admin types, and declaring otherwise takes a cast that type-checks while the
 * value travels (`docs/frontend/spec.md` I33).
 */
export type FLSpielWithDraftFields = Omit<FLSpielWithStoredSides, "ort" | "schiedsrichter"> & {
  ort: FLSpielOrtFieldDraft | null;
  schiedsrichter: FLSpielSchiedsrichterFieldDraft | null;
};

export const FLSpieleListResponseSchema = BaseAPIResponseSchema.extend({
  spiele: z.array(FLSpielSchema),
});
export type FLSpieleListResponse = z.infer<typeof FLSpieleListResponseSchema>;

/** One fixture as a base-tier read serves it, addressed by its own id. */
export const FLSpieleSingleResponseSchema = BaseAPIResponseSchema.extend({
  spiel: FLSpielSchema,
});
export type FLSpieleSingleResponse = z.infer<typeof FLSpieleSingleResponseSchema>;

/**
 * What the match editor loads. The page is addressed by match id alone, so this read is also what
 * tells it which season's lookup lists to load — a list read cannot, needing that same season to
 * filter by.
 */
export const FLSpieleAdminSingleResponseSchema = BaseAPIResponseSchema.extend({
  spiel: FLSpielAdminSchema,
});
export type FLSpieleAdminSingleResponse = z.infer<typeof FLSpieleAdminSingleResponseSchema>;

/**
 * Composed from the field schemas above rather than redeclared, so the write shape cannot drift
 * from the read shape. The composition is intra-slice: this write path is not `admin`'s.
 */
export const FLPatchSpielDataPayloadSchema = z.object({
  datum: CustomDateStringSchema.nullable(),
  uhrzeit: CustomTimeStringSchema.nullable(),

  // The payload halves, so `strip` drops the display copies the draft carries for the pickers: the
  // server composes each from the row its id names, and a copy sent back could only disagree.
  ort: FLSpielOrtFieldPayloadSchema.nullable(),
  schiedsrichter: FLSpielSchiedsrichterFieldPayloadSchema.nullable(),

  team1: FLSpielTeamFieldPayloadSchema.nullable(),
  team2: FLSpielTeamFieldPayloadSchema.nullable(),

  // Present because `$set` overwrites what the request omits: leaving these off would erase a
  // bracket's wiring on the first edit.
  team1_quelle: FLSpielQuelleSchema.nullable(),
  team2_quelle: FLSpielQuelleSchema.nullable(),

  // The same `$set` reason: omitting it would retract a shoot-out on the first kick-off edit.
  elfmeterschiessen: FLSpielElfmeterschiessenSchema.nullable(),

  // The same `$set` reason. An emptied textarea submits "", which the backend coerces to null.
  notiz: z.string().nullable(),

  spiel_id: CustomObjectIdStringSchema,

  // The same `$set` reason, and nullable rather than optional: dropping the event is how a fixture
  // goes back on, so "no event" has to travel as a value.
  sonderereignis: FLSonderereignisSchema.nullable(),
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
 * Derived from a fixture's DATE against a junction record rather than a bracket reference, so it
 * reaches a Gruppenphase fixture too (`docs/backend/spec.md` I28). Which dates count:
 * `fl_backend/app/api/spiele/services.py :: find_departed_occupants`.
 */
export const FLBracketFaultOccupantSchema = z.object({
  reason: z.literal("departed_occupant"),
  spiel_id: CustomObjectIdStringSchema,
  spiel_nr: z.int().positive(),
  side: z.enum(["team1", "team2"]),
  team_id: CustomObjectIdStringSchema,
  team_name: z.string().nonempty(),
  // Carried although nothing here decides on it: it is what lets the copy name the route out, a
  // withdrawal reported as a disqualification being the untruth the neutral record prevents.
  austritt_type: FLAustrittSchema.shape.type,
  ausgeschieden_seit: CustomDateStringSchema,
  spiel_datum: CustomDateStringSchema.nullable(),
});
export type FLBracketFaultOccupant = z.infer<typeof FLBracketFaultOccupantSchema>;

/**
 * One club standing more than once on the same Spieltag, reported once per APPEARANCE — so a club
 * on both sides of one fixture arrives as two entries on it. Nothing is emptied: which fixture to
 * correct is a competition decision.
 */
export const FLBracketFaultSpieltagSchema = z.object({
  reason: z.literal("fielded_twice"),
  spiel_id: CustomObjectIdStringSchema,
  spiel_nr: z.int().positive(),
  // What GROUPS the entries: one clash is every appearance sharing this id and a club, and the
  // entries arrive as one flat list.
  spieltag_id: CustomObjectIdStringSchema,
  side: z.enum(["team1", "team2"]),
  team_id: CustomObjectIdStringSchema,
  team_name: z.string().nonempty(),
});
export type FLBracketFaultSpieltag = z.infer<typeof FLBracketFaultSpieltagSchema>;

/**
 * `discriminatedUnion` rather than a flat object of optional fields: each variant carries exactly
 * its own fault's fields, so nobody has to know which combinations mean anything.
 */
export const FLBracketFaultSchema = z.discriminatedUnion("reason", [
  FLBracketFaultGruppeSchema,
  FLBracketFaultQuelleSchema,
  FLBracketFaultSpielSchema,
  FLBracketFaultOccupantSchema,
  FLBracketFaultSpieltagSchema,
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
  // Only ever a no-show: `ausgefallen`, `annulliert` and `abgebrochen` name no side, so a replaced
  // occupant leaves each of them true and none of them is cleared.
  voided_sonderereignis: FLSonderereignisSchema.nullable(),
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
  // A no-show alone, for `FLSpielAdvancementSchema`'s reason.
  voided_sonderereignis: FLSonderereignisSchema.nullable(),
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
