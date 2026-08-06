/**
 * SPIELE · models
 *
 * The Zod read model, the admin patch payload composed from it, and the draft types the edit form uses
 * while a field is mid-edit.
 *
 * These are HAND-MIRRORED by `fl_backend/app/api/spiele/schemas.py` in Pydantic. There is no generation
 * step, so a constraint changed there must be changed here in the same commit.
 *
 * `src/core/apiContract.test.ts` compares the two (ADR-0040) on presence, requiredness, nullability,
 * primitive type and enum members. It does NOT compare patterns, lengths or ranges — the German
 * messages and the regexes below are this file's alone, and are the first thing to check when
 * behaviour looks impossible.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • The patch payload composes from the read model's field schemas rather than redeclaring them, so
 *     the write shape cannot drift from the read shape.
 *   • A fixture side is `null` when its occupant is not yet known, and `teamN_quelle` says where that
 *     occupant comes from (ADR-0041, ADR-0042). The two are independent and nothing pairs them, so every
 *     consumer reads `team?.name ?? formatQuelle(quelle) ?? "Noch offen"` and never branches on a state.
 *   • `quelle` is a REFERENCE and carries no German. `formatQuelle` in `utils.ts` derives what a card
 *     shows, so the label exists in exactly one place instead of being stored per fixture.
 *   • Zod's default `strip` mode discards undeclared fields silently. A field the backend sends but
 *     this schema omits is lost with no error — that is how `saison_id` went missing.
 *   • Draft types exist so an emptied currency field is `null` rather than silently `0`. The strict
 *     schemas still reject `null`, so a cleared field fails with a German message on the field.
 *   • A shoot-out is its OWN scoreline in `elfmeterschiessen`, never a third number inside `ergebnis`
 *     (ADR-0044). Its counts decide the bracket and are invisible to the league table, so
 *     `computeErgebnisFor` still answers "D" for a fixture settled on penalties.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/backend/spec.md — section 3, what PATCH /spiele/{spiel_id} does with this payload
 *   docs/backend/spec.md — invariant I16: no database validator constrains a range, a pattern or a
 *   length, so these schemas and their Pydantic twin are the only place those constraints are stated
 */

import z from "zod";

import { BaseAPIResponseSchema } from "@/core/schemas";
import { FLGruppenNamesSchema } from "@/features/teams/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, CustomTimeStringSchema } from "@/shared/schemas";

import { FLSaisonPhaseSchema } from "../saisons/schemas";

export const FLSpielStatusSchema = z.enum(["ausstehend", "vergangen", "heute", "abgesagt", "unbekannt"], { error: "FLSpielStatus is invalid" });
export type FLSpielStatus = z.infer<typeof FLSpielStatusSchema>;

export const FLSpielTeamFieldSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  name: z.string(),
  tore: z.int().nonnegative().nullable(),
  shorthand: z.string().length(2),
});
export type FLSpielTeamField = z.infer<typeof FLSpielTeamFieldSchema>;

export const FLSpielOrtFieldSchema = z.object({
  spielort_id: CustomObjectIdStringSchema,
  name: z.string().nonempty(),
  maps_link: z.string().nonempty(),
  // The message goes on the TYPE check, not on `nonnegative()`: the reachable failure is a cleared
  // field arriving as `null`, and every one of these inputs has `minValue={0}`, so a negative number
  // never gets here.
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
 * The edit form's in-progress shapes. An emptied currency field is `null` while the admin is typing
 * — it must not silently become 0, which is what shipped a 0 € Mietpreis whenever someone cleared
 * the box. The strict schemas above still reject `null`, so a cleared
 * field fails validation with the German message on it rather than saving a wrong number.
 */
export type FLSpielOrtFieldDraft = Omit<FLSpielOrtField, "mietpreis"> & { mietpreis: number | null };
export type FLSpielSchiedsrichterFieldDraft = Omit<FLSpielSchiedsrichterField, "payment"> & { payment: number | null };

/**
 * The shoot-out while an admin is typing it. Both counts are `null` until entered, for the same reason
 * a currency field is: `0` is a real value here — a side can miss every kick — so an empty box must
 * not read as one.
 */
export type FLSpielElfmeterschiessenDraft = { team1: number | null; team2: number | null };

/**
 * Where one side of a bracket fixture comes from. Mirrors `FLSpielQuelle`.
 *
 * A tagged union, discriminated on `type`, because there are exactly two ways a slot is fed: the first
 * knockout round is seeded from the group standings, and every round after it by matches in the round
 * before (ADR-0042). `z.discriminatedUnion` rather than `z.union`, so a malformed source reports the
 * variant's own field errors instead of a union-wide "no match".
 *
 * The discriminator is English because it names the shape of the object rather than anything in the
 * competition; its two values, and every other key here, are domain vocabulary and stay German.
 */
export const FLSpielQuelleGruppeSchema = z.object({
  type: z.literal("gruppe"),
  gruppe: FLGruppenNamesSchema,
  // The message goes on the TYPE check for the same reason `mietpreis`'s does: the reachable failure
  // is an unpicked placing, which the form drafts as `NaN`, and `NaN` fails `z.int()` before
  // `.positive()` ever runs.
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
 * The penalty shoot-out that settled a knockout whose goals finished level. Mirrors
 * `FLSpielElfmeterschiessen`.
 *
 * A scoreline of its own, kept out of `ergebnis` because both ends parse that string to derive
 * win/draw/loss and a third number would read as a malformed value on every card (ADR-0044). The two
 * counts are not goals: the bracket reads a winner off them and the league table counts the fixture as
 * the draw it was.
 *
 * The winner is derived, so there is no `sieger` field to contradict the counts — the same reasoning
 * that kept an override flag off `quelle`.
 */
export const FLSpielElfmeterschiessenSchema = z
  .object({
    // The message goes on the TYPE check, as `platz`'s and `mietpreis`'s do: an emptied NumberField
    // arrives as `NaN`, which fails `z.int()` before `.nonnegative()` ever runs.
    team1: z.int({ error: "Bitte gib die Treffer von Team 1 ein." }).nonnegative({ error: "Die Treffer dürfen nicht negativ sein." }),
    team2: z.int({ error: "Bitte gib die Treffer von Team 2 ein." }).nonnegative({ error: "Die Treffer dürfen nicht negativ sein." }),
  })
  // Mirrors the model validator. A level shoot-out names nobody, which puts the fixture back exactly
  // where a drawn knockout sits — no winner, and now a filled-in record implying otherwise.
  .refine((schiessen) => schiessen.team1 !== schiessen.team2, {
    error: "Ein Elfmeterschießen kann nicht unentschieden enden.",
    path: ["team2"],
  });
export type FLSpielElfmeterschiessen = z.infer<typeof FLSpielElfmeterschiessenSchema>;

export const FLSpielSchema = z.object({
  id: CustomObjectIdStringSchema,
  spieltag_id: CustomObjectIdStringSchema,

  // `null` while the occupant is unknown — a playoff slot the group phase has not filled yet.
  team1: FLSpielTeamFieldSchema.nullable(),
  team2: FLSpielTeamFieldSchema.nullable(),

  // Where each side comes from. Survives the team arriving, so it is a sibling of the field above
  // rather than a key inside it (ADR-0041). `null` also means "this slot is the admin's": clearing
  // it is the one way to take a slot out of automatic maintenance (ADR-0042).
  team1_quelle: FLSpielQuelleSchema.nullable(),
  team2_quelle: FLSpielQuelleSchema.nullable(),

  datum: CustomDateStringSchema.nullable(),
  uhrzeit: CustomTimeStringSchema.nullable(),

  ort: FLSpielOrtFieldSchema.nullable(),
  schiedsrichter: FLSpielSchiedsrichterFieldSchema.nullable(),

  // "Tore:Tore". Not free text -- TeamDetailsView splits it on ":" to derive W/D/L, and a
  // malformed "3" silently rendered as a loss for both teams. null means "not played yet".
  ergebnis: z
    .string()
    .regex(/^[0-9]+:[0-9]+$/, "Ergebnis muss die Form 'Tore:Tore' haben, z. B. '3:1'")
    .nullable(),

  // How a knockout that finished level was settled, and `null` on every match that did not — which is
  // almost all of them (ADR-0044).
  elfmeterschiessen: FLSpielElfmeterschiessenSchema.nullable(),

  spiel_nr: z.int().positive(),
  is_canceled: z.boolean(),
  saison_phase: FLSaisonPhaseSchema,
  // The backend sends this (FLSpiel.saison_id, min_length=4, max_length=4). Until it was declared
  // here, zod's default strip mode discarded it silently -- which is why the admin patch action has
  // no season id to invalidate a granular cache tag with.
  saison_id: z.string().length(4),
});
export type FLSpiel = z.infer<typeof FLSpielSchema>;

export const FLSpieleListResponseSchema = BaseAPIResponseSchema.extend({
  spiele: z.array(FLSpielSchema),
});
export type FLSpieleListResponse = z.infer<typeof FLSpieleListResponseSchema>;

/**
 * One match by its id, for the page whose subject IS that match (ADR-0034, ADR-0050).
 *
 * The edit page is addressed by match id alone and a match carries its own `saison_id`, so this read is
 * what tells that page which season's lookup lists to load. A list read cannot: it needs the season to
 * filter by, which is the answer this response supplies.
 */
export const FLSpieleSingleResponseSchema = BaseAPIResponseSchema.extend({
  spiel: FLSpielSchema,
});
export type FLSpieleSingleResponse = z.infer<typeof FLSpieleSingleResponseSchema>;

/**
 * The admin edit payload, composed from the field schemas above rather than redeclaring them, so
 * the write shape cannot drift from the read shape. That composition is intra-slice and must stay
 * so: the Spiel write path belongs to this slice, not to `admin` (ADR-0005).
 */
export const FLPatchSpielDataPayloadSchema = z.object({
  datum: CustomDateStringSchema.nullable(),
  uhrzeit: CustomTimeStringSchema.nullable(),

  ort: FLSpielOrtFieldSchema.nullable(),
  schiedsrichter: FLSpielSchiedsrichterFieldSchema.nullable(),

  team1: FLSpielTeamFieldSchema.nullable(),
  team2: FLSpielTeamFieldSchema.nullable(),

  // On the payload because the handler writes it back wholesale with `$set`: a field the request
  // omits is overwritten, so leaving these off would erase a bracket's wiring on the first edit.
  team1_quelle: FLSpielQuelleSchema.nullable(),
  team2_quelle: FLSpielQuelleSchema.nullable(),

  // On the payload for the same `$set` reason as the two above: omitted means overwritten, so leaving
  // it off would retract a recorded shoot-out on the first edit of a kick-off time. The handler keeps
  // it only where the goals it accompanies are level (ADR-0044).
  elfmeterschiessen: FLSpielElfmeterschiessenSchema.nullable(),

  spiel_id: CustomObjectIdStringSchema,
  is_canceled: z.boolean(),
});

export type FLPatchSpielDataPayload = z.infer<typeof FLPatchSpielDataPayloadSchema>;

/**
 * One bracket slot whose group reference names a placing the standings will never hand it (ADR-0043).
 *
 * `gruppe_too_small` is a typo — the group holds fewer teams that can advance than the `platz` asks
 * for — and the slot keeps whatever it holds. `tie_unresolved` is a real outcome: the group is played
 * out and the tiebreak chain still cannot separate two teams there, so the slot IS emptied and a person
 * has to clear the source and enter a side.
 *
 * A group still being played is in neither: that placing is simply not decided yet, and "not yet" is
 * not something to put in front of an admin.
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
 * One bracket slot whose match reference cannot state an outcome — a missing number, or a cycle.
 *
 * `quelle_spiel_nr` is the number the slot names, which is the value to correct. A cycle is reported on
 * every fixture the loop reaches, because none of them is derivable.
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
 * The five stored bracket faults, tagged on `reason` (ADR-0047).
 *
 * `discriminatedUnion` rather than a flat object with optional fields, mirroring `FLSpielQuelleSchema`
 * and the Pydantic union it is hand-mirrored from: each variant carries exactly the fields its own fault
 * needs, so a reader never has to know which combinations mean anything.
 */
export const FLBracketFaultSchema = z.discriminatedUnion("reason", [
  FLBracketFaultGruppeSchema,
  FLBracketFaultQuelleSchema,
  FLBracketFaultSpielSchema,
]);
export type FLBracketFault = z.infer<typeof FLBracketFaultSchema>;

/**
 * What the admin patch returns: the envelope, plus the bracket fixtures the write moved.
 *
 * `advanced_to` holds the `spiel_nr` of every fixture the result entry resolved — the semi-final that
 * gained its winner, and, after a correction, the later fixture that lost an occupant it should never
 * have had (ADR-0042). It reports what happened, so a fixture that was emptied is named as readily as
 * one that was filled, and the toast that quotes it says "aktualisiert" rather than naming a winner.
 *
 * **Declared here rather than parsed as a bare `BaseAPIResponseSchema`.** Zod's default `strip` mode
 * discards an undeclared key silently, so a response field with no entry in a schema never reaches the
 * caller and nothing reports that it did not — the same way `saison_id` went missing.
 *
 * Not `.optional()`: the backend's `default_factory` puts the field outside the published `required`
 * list, but every declared property of a response model is on the wire, so it always arrives.
 */
export const FLPatchSpielDataResponseSchema = BaseAPIResponseSchema.extend({
  advanced_to: z.array(z.int()),
  bracket_faults: z.array(FLBracketFaultSchema),
});

export type FLPatchSpielDataResponse = z.infer<typeof FLPatchSpielDataResponseSchema>;

/**
 * What `GET /spiele/action_required` returns: the matches needing attention, and why the bracket ones do.
 *
 * `spiele` carries every match the route's filter selected plus every match a fault below names, so the
 * client always holds the document behind a fault. A fault joins to its match by `spiel_id`, never by
 * `spiel_nr`, which repeats across the seasons this route spans.
 */
export const FLSpieleActionRequiredResponseSchema = BaseAPIResponseSchema.extend({
  spiele: z.array(FLSpielSchema),
  bracket_faults: z.array(FLBracketFaultSchema),
});

export type FLSpieleActionRequiredResponse = z.infer<typeof FLSpieleActionRequiredResponseSchema>;
