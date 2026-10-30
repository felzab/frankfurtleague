// Redesign: goes with its last importer.
import z from "zod";

import { FLGruppenNamesSchema } from "@/features/teams/schemas";
import { CustomDateStringSchema, CustomObjectIdStringSchema, CustomTimeStringSchema } from "@/shared/schemas";

import { NOTIZ_MAX_LENGTH } from "./constants";

// The old match form's own judgement of its draft, in words an administrator reads, before its action sends the
// write through the generated client, which types the body against the write's published contract.

/**
 * What happened to a fixture beyond being played: `fl_backend/app/shared/schemas/literals.py :: FLSonderereignis`.
 */
const SONDEREREIGNIS_UNGEWAEHLT = "Bitte wähle ein Sonderereignis.";

export const FLSonderereignisSchema = z.enum(["ausgefallen", "nichtantreten_team1", "nichtantreten_team2", "abgebrochen", "annulliert"], {
  // A sentence, being bound to a picker in the match editor.
  error: SONDEREREIGNIS_UNGEWAEHLT,
});

/**
 * One side as the admin PATCH submits it: which club, and what it scored. No name and no shorthand
 * — the season's `saison_teams` row is where a club's name lives, so a copy a client sent could only
 * disagree with it. The server composes both.
 */
const FLSpielTeamFieldPayloadSchema = z.object({
  team_id: CustomObjectIdStringSchema,
  tore: z.int().nonnegative().nullable(),
});

/**
 * The venue as the admin PATCH submits it. `mietpreis` stays on the payload where the name does not:
 * it is THIS fixture's rent rather than a copy of the venue's current default, so dropping it from
 * the wire would rewrite a rent on every save.
 */
const FLSpielOrtFieldPayloadSchema = z.object({
  spielort_id: CustomObjectIdStringSchema,
  // The message goes on the TYPE check: the reachable failure is a cleared field arriving as
  // `null`, since every one of these inputs carries `minValue={0}`.
  mietpreis: z.int({ error: "Bitte gib einen Mietpreis ein." }).nonnegative({ error: "Der Mietpreis darf nicht negativ sein." }),
});

/** The referee as the admin PATCH submits it; `payment` stays on the wire for `mietpreis`' reason. */
const FLSpielSchiedsrichterFieldPayloadSchema = z.object({
  schiedsrichter_id: CustomObjectIdStringSchema,
  payment: z.int({ error: "Bitte gib ein Honorar ein." }).nonnegative({ error: "Das Honorar darf nicht negativ sein." }),
});

/**
 * `z.discriminatedUnion` rather than `z.union`, so a malformed source reports the variant's own
 * field errors instead of a union-wide "no match". The discriminator names a shape and is English;
 * its values are competition vocabulary, German.
 */
const FLSpielQuelleGruppeSchema = z.object({
  type: z.literal("gruppe", { error: "Bitte wähle aus, woher das Team kommt." }),
  gruppe: FLGruppenNamesSchema,
  // On the TYPE check as `mietpreis`'s is: an unpicked placing drafts as `NaN`, which fails
  // `z.int()` before `.positive()` runs.
  platz: z.int({ error: "Bitte wähle einen Platz aus." }).positive({ error: "Der Platz muss mindestens 1 sein." }),
});

const FLSpielQuelleSpielSchema = z.object({
  type: z.literal("spiel", { error: "Bitte wähle aus, woher das Team kommt." }),
  spiel_nr: z.int({ error: "Bitte wähle ein Spiel aus." }).positive({ error: "Die Spielnummer muss mindestens 1 sein." }),
  ausgang: z.enum(["sieger", "verlierer"], { error: "Bitte wähle Sieger oder Verlierer." }),
});

const FLSpielQuelleSchema = z.discriminatedUnion("type", [FLSpielQuelleGruppeSchema, FLSpielQuelleSpielSchema], {
  // The discriminator too: an absent or unknown `type` otherwise answers with the slugs themselves.
  error: "Bitte wähle aus, woher das Team kommt.",
});

/**
 * Kept out of `ergebnis`: both ends parse that string for win/draw/loss and a third number reads as
 * malformed. The counts are not goals — the bracket takes a winner from them, the table the draw.
 * The winner is derived, never stored.
 */
export const FLSpielElfmeterschiessenSchema = z
  .object({
    // On the TYPE check: an emptied box arrives as `null`, failing `z.int()` first.
    team1: z.int({ error: "Bitte gib die Treffer von Team 1 ein." }).nonnegative({ error: "Die Treffer dürfen nicht negativ sein." }),
    team2: z.int({ error: "Bitte gib die Treffer von Team 2 ein." }).nonnegative({ error: "Die Treffer dürfen nicht negativ sein." }),
  })
  // Mirrors the model validator: a level shoot-out names nobody, leaving a filled-in record that
  // implies a winner the fixture does not have.
  .refine((schiessen) => schiessen.team1 !== schiessen.team2, {
    error: "Ein Elfmeterschießen kann nicht unentschieden enden.",
    path: ["team2"],
  });

/** Composed from the field schemas above rather than redeclared. The composition is intra-slice: this write path is not `admin`'s. */
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
  notiz: z
    .string()
    .max(NOTIZ_MAX_LENGTH, { error: `Die Notiz darf höchstens ${String(NOTIZ_MAX_LENGTH)} Zeichen lang sein.` })
    .nullable(),

  spiel_id: CustomObjectIdStringSchema,

  // The same `$set` reason, and nullable rather than optional: dropping the event is how a fixture
  // goes back on, so "no event" has to travel as a value.
  sonderereignis: FLSonderereignisSchema.nullable(),

  // The referee the editor was served, never one it picked: the save is refused where the fixture books another or
  // none since (`REQ-BOOKING-003`), so a referee's own decline is not undone by an editor opened before it.
  schiedsrichter_stand: CustomObjectIdStringSchema.nullable(),
});

/**
 * The payload as the editor judges it. A FACTORY because the switch asserting an event is editor state the payload
 * has no field for, and the write path takes `null` as no event: unrefused, an unpicked event saves as none.
 */
export function buildPatchSpielDataPayloadSchema({ hasSonderereignis }: { hasSonderereignis: boolean }) {
  if (!hasSonderereignis) return FLPatchSpielDataPayloadSchema;

  return FLPatchSpielDataPayloadSchema.refine((spiel) => spiel.sonderereignis !== null, {
    error: SONDEREREIGNIS_UNGEWAEHLT,
    path: ["sonderereignis"],
  });
}
