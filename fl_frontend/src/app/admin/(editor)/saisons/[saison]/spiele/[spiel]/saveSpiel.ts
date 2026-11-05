"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { spielePatchSpiel } from "@/core/generated/client/sdk";
import { SpielePatchSpielBody, SpielePatchSpielParams } from "@/core/generated/zod/inputs";
import { getAdminSpiel } from "@/features/spiele/queries";
import { admitsShootOut } from "@/features/spiele/shootOut";

import { isNoShow, NO_SONDEREREIGNIS, takesNoResult, valuesOf } from "./spielValues";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { FLPatchSpielDataPayload, FLPatchSpielDataResponse, FLSpielJoinedAdmin } from "@/core/generated/client/types";

const { shape } = SpielePatchSpielBody;
const [ortShape] = shape.ort.options;
const [schiedsrichterShape] = shape.schiedsrichter.options;
const [teamShape] = shape.team1.options;
const [shootOutShape] = shape.elfmeterschiessen.options;

/** A figure's box: empty is no figure, digits alone a figure, anything else stays text the rule refuses. */
const figure = (rule: z.ZodType<number>) =>
  z.preprocess(
    (value) => (value === "" ? null : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value),
    z.union([rule, z.null()]),
  );

/** What the editor's boxes send, each held to the match write's own published rule for it. */
const SaveSpiel = z.object({
  id: SpielePatchSpielParams.shape.spiel_id,
  // The fixture's version as the editor read it.
  version: shape.version,
  // The report's version the result was carried over from by „Übernehmen“, which the save stamps adopted.
  adoptsBericht: z.union([z.int().min(1), z.null()]),
  changes: z
    .object({
      team1: z.union([teamShape.shape.team_id, z.null()]),
      team2: z.union([teamShape.shape.team_id, z.null()]),
      datum: shape.datum,
      uhrzeit: shape.uhrzeit,
      spielort: z.union([ortShape.shape.spielort_id, z.null()]),
      mietpreis: figure(ortShape.shape.mietpreis),
      schiedsrichter: z.union([schiedsrichterShape.shape.schiedsrichter_id, z.null()]),
      honorar: figure(schiedsrichterShape.shape.payment),
      hasResult: z.boolean(),
      tore1: figure(z.int().min(0)),
      tore2: figure(z.int().min(0)),
      shootOut1: figure(shootOutShape.shape.team1),
      shootOut2: figure(shootOutShape.shape.team2),
      sonderereignis: z.preprocess((value) => (value === NO_SONDEREREIGNIS ? null : value), shape.sonderereignis),
      notiz: shape.notiz,
    })
    .partial(),
});

type Save = z.output<typeof SaveSpiel>;
type Changes = Save["changes"];

/** A figure as the stored fixture holds it, or the one the box now holds. */
const storedFigure = (text: string) => (text === "" ? null : Number(text));

/**
 * The fixture as it stands with the editor's changes over it. The write replaces the whole fixture, so every field
 * the editor does not change is sent as it is stored. A club picked by hand stands on its side without the side's
 * source, so the bracket's resolution leaves it there; a side left alone keeps its club and its source. Goals stand
 * only where a result is entered and the event leaves the match one; a no-show's are the award the write composes.
 */
function payloadOf(saved: FLSpielJoinedAdmin, changes: Changes): Omit<FLPatchSpielDataPayload, "version"> | ActionAnswer<never> {
  const stored = valuesOf(saved);

  const spielort = changes.spielort === undefined ? stored.spielort : changes.spielort;
  const mietpreis = changes.mietpreis === undefined ? storedFigure(stored.mietpreis) : changes.mietpreis;
  const schiedsrichter = changes.schiedsrichter === undefined ? stored.schiedsrichter : changes.schiedsrichter;
  const honorar = changes.honorar === undefined ? storedFigure(stored.honorar) : changes.honorar;
  const sonderereignis = changes.sonderereignis === undefined ? saved.sonderereignis : changes.sonderereignis;
  const hasResult = changes.hasResult ?? stored.hasResult;
  const tore1 = changes.tore1 === undefined ? storedFigure(stored.tore1) : changes.tore1;
  const tore2 = changes.tore2 === undefined ? storedFigure(stored.tore2) : changes.tore2;
  const shootOut1 = changes.shootOut1 === undefined ? storedFigure(stored.shootOut1) : changes.shootOut1;
  const shootOut2 = changes.shootOut2 === undefined ? storedFigure(stored.shootOut2) : changes.shootOut2;

  const fieldErrors: Record<string, Copy> = {};
  const required = COPY.shared.field.required;
  // A booking's price and fee are required while it is made.
  if (spielort !== null && mietpreis === null) fieldErrors["changes.mietpreis"] = required;
  if (schiedsrichter !== null && honorar === null) fieldErrors["changes.honorar"] = required;
  // An entered result names both sides' goals, as a shoot-out does once either of its figures is typed.
  const scored = hasResult && !isNoShow(sonderereignis) && !takesNoResult(sonderereignis);
  if (scored && tore1 === null) fieldErrors["changes.tore1"] = required;
  if (scored && tore2 === null) fieldErrors["changes.tore2"] = required;
  const sideOf = (side: "team1" | "team2", tore: number | null) => {
    const picked = changes[side];
    const team = picked === undefined ? (saved[side]?.team_id ?? null) : picked;
    return team === null ? null : { team_id: team, tore: scored ? tore : null };
  };
  const team1 = sideOf("team1", tore1);
  const team2 = sideOf("team2", tore2);
  // Judged only where the fixture takes a shoot-out: one typed before the goals moved off level is dropped, as the write drops it.
  const takesShootOut = admitsShootOut(saved.saison_phase, team1, team2, sonderereignis);
  const shootOutTyped = takesShootOut && (shootOut1 !== null || shootOut2 !== null);
  if (shootOutTyped && shootOut1 === null) fieldErrors["changes.shootOut1"] = required;
  if (shootOutTyped && shootOut2 === null) fieldErrors["changes.shootOut2"] = required;
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  const shootOut = !takesShootOut || shootOut1 === null || shootOut2 === null ? null : { team1: shootOut1, team2: shootOut2 };

  return {
    datum: changes.datum === undefined ? stored.datum : changes.datum,
    uhrzeit: changes.uhrzeit === undefined ? stored.uhrzeit : changes.uhrzeit,
    ort: spielort === null || mietpreis === null ? null : { spielort_id: spielort, mietpreis },
    schiedsrichter: schiedsrichter === null || honorar === null ? null : { schiedsrichter_id: schiedsrichter, payment: honorar },
    team1,
    team2,
    // A hand-picked club no longer follows the side's source: the resolution keeps a side with none as it stands.
    team1_quelle: changes.team1 === undefined ? saved.team1_quelle : null,
    team2_quelle: changes.team2 === undefined ? saved.team2_quelle : null,
    elfmeterschiessen: shootOut,
    sonderereignis,
    notiz: changes.notiz === undefined ? stored.notiz : changes.notiz,
  };
}

/**
 * The codes the match write answers that this editor words, each a person causes knowingly from it; a team's
 * refusal is the stale-page line, the editor offering only the clubs the write takes.
 */
const OWN_WORDS = [
  "spiel_outside_spieltag",
  "state_ergebnis_on_a_non_event",
  "state_nichtantreten_without_two_sides",
  "booking_unknown_resource",
  "booking_unconfirmed_schiedsrichter",
  "spiel_double_booked",
  "eligibility_disqualified",
  "elfmeterschiessen_without_winner",
  // The editor stays open on a finished season, whose fixtures the write refuses whole.
  "saison_past",
] as const;

/** The other fixtures a write moved or would move, each once, in their numbers' order. */
const numbersOf = (entries: readonly { spiel_nr: number }[]) =>
  [...new Set(entries.map(({ spiel_nr }) => spiel_nr))].toSorted((first, second) => first - second);

/** The fixture as stored, read for the fields the editor does not show, which the wholesale write sends as stored. */
async function sending(id: string, changes: Changes) {
  const read = await getAdminSpiel(id);
  if (read === null) return { ok: false, reason: COPY.shared.failure.stale } as const;
  return payloadOf(read.spiel, changes);
}

/**
 * Saves the match editor's changes, answering the fixture's new version, which the editor takes as its own. The
 * version sent is the one the editor was read at: where the fixture has changed since, the write refuses the save as
 * stale (`version_stale`) rather than writing over it. A result carried over from the report stamps it adopted.
 */
export const saveSpiel = action({
  lane: "admin",
  name: "saveSpiel",
  input: SaveSpiel,
  ownWords: OWN_WORDS,
  // The boxes a field pattern's phrase lands on; every other refusal here is a sentence naming its field itself.
  paths: { sonderereignis: "changes.sonderereignis" },
  examples: { "changes.mietpreis": COPY.admin.spielort.mietpreisExample },
  run: async ({ id, version, adoptsBericht, changes }): Promise<ActionAnswer<number>> => {
    const payload = await sending(id, changes);
    if ("ok" in payload) return payload;

    const written = await spielePatchSpiel(id, { ...payload, version }, adoptsBericht === null ? undefined : { adopts_bericht: adoptsBericht });

    // The other fixtures the write changed: a later round's occupant or result, or a side it released on the same
    // Spieltag. The match's own page says what changed there.
    const value = written.version;
    const changed = numbersOf([...written.advanced_to, ...written.released_sides]);
    return changed.length === 0 ? { ok: true, value } : { ok: true, value, note: COPY.admin.spiel.alsoChanged(changed) };
  },
});

/** The later matches whose stored result a write would delete: a dry run's report, never a guess. */
const voidedBy = (report: FLPatchSpielDataResponse) =>
  numbersOf(
    [...report.advanced_to, ...report.released_sides].filter(
      (moved) => moved.voided_ergebnis !== null || moved.voided_elfmeterschiessen !== null || moved.voided_sonderereignis !== null,
    ),
  );

/**
 * What saving these changes would delete beyond the fixture: the numbers of the later matches whose results the write
 * would void, from the write's own dry run, which writes nothing. The editor asks before a save that voids any.
 */
export const previewSpiel = action({
  lane: "admin",
  name: "previewSpiel",
  input: SaveSpiel,
  run: async ({ id, version, changes }): Promise<ActionAnswer<readonly number[]>> => {
    const payload = await sending(id, changes);
    if ("ok" in payload) return payload;
    const report = await spielePatchSpiel(id, { ...payload, version }, { dry_run: true });
    return { ok: true, value: voidedBy(report) };
  },
});
