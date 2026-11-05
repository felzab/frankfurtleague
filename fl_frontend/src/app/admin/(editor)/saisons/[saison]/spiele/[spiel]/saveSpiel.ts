"use server";

import { z } from "zod";

import { action, numberBox } from "@/core/action";
import { COPY } from "@/core/copy";
import { formatList } from "@/core/format";
import { spielePatchSpiel } from "@/core/generated/client/sdk";
import { SpielePatchSpielBody, SpielePatchSpielParams } from "@/core/generated/zod/inputs";
import { getAdminSpiel } from "@/features/spiele/queries";
import { admitsShootOut } from "@/features/spiele/shootOut";

import { isNoShow, NO_SONDEREREIGNIS, takesNoResult, valuesOf } from "./spielValues";

import type { ActionAnswer, SaveQuestion } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { FLPatchSpielDataPayload, FLPatchSpielDataResponse, FLSpielJoinedAdmin } from "@/core/generated/client/types";

const { shape } = SpielePatchSpielBody;
const [ortShape] = shape.ort.options;
const [schiedsrichterShape] = shape.schiedsrichter.options;
const [teamShape] = shape.team1.options;
const [shootOutShape] = shape.elfmeterschiessen.options;

/** A figure's box, which the editor may leave empty: no figure where the stored fixture holds none. */
const figure = (rule: z.ZodType<number>) => numberBox(z.union([rule, z.null()]));

/** What the editor's boxes send, each held to the match write's own published rule for it. */
const SaveSpiel = z.object({
  id: SpielePatchSpielParams.shape.spiel_id,
  // The fixture's version as the editor read it.
  version: shape.version,
  // The report's version the result was carried over from by „Übernehmen“, which the save stamps adopted.
  adoptsBericht: z.union([z.int().min(1), z.null()]),
  // The token of the question the person confirmed, naming what they confirmed the save would delete.
  confirm: z.string().optional(),
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
 * refusal is the stale-page line, the editor offering only the clubs the write takes, but for the bracket fielding a
 * club twice, which a hand-picked side causes on a current page and a resend meets again.
 */
const OWN_WORDS = [
  "spieltag_occupied_by_the_resolution",
  "spiel_outside_spieltag",
  "state_ergebnis_on_a_non_event",
  "state_nichtantreten_without_two_sides",
  "booking_unknown_resource",
  "spiel_double_booked",
  "eligibility_disqualified",
  "elfmeterschiessen_without_winner",
  // The editor stays open on a finished season, whose fixtures the write refuses whole.
  "saison_past",
  // A later result entered or changed between the question and the confirmed write, which refuses to delete it unasked.
  "voided_results_stale",
] as const;

/** The other fixtures a write moved or would move, each once, in their numbers' order. */
const numbersOf = (entries: readonly { spiel_nr: number }[]) =>
  [...new Set(entries.map(({ spiel_nr }) => spiel_nr))].toSorted((first, second) => first - second);

/** The fixture as stored, read for the fields the editor does not show, which the wholesale write sends as stored. */
async function sending(id: string, changes: Changes): Promise<ActionAnswer<never> | Omit<FLPatchSpielDataPayload, "version">> {
  const read = await getAdminSpiel(id);
  return read === null ? { ok: false, reason: COPY.shared.failure.stale } : payloadOf(read.spiel, changes);
}

/**
 * The question a save asks before it deletes a later match's result, `null` for a save deleting none, naming under its
 * sentence whom the save mails, each by the name the dry run reads off its own record, as every question naming its
 * act's mails does. Its token names each deleted result by
 * its value as well as its match, and the parties in their names' order, so a confirmation covers exactly what it was
 * shown and an unchanged save is never asked twice. A save that only mails asks nothing.
 */
function questionOf(report: FLPatchSpielDataResponse): SaveQuestion | null {
  const voided = report.voided_results;
  if (voided.length === 0) return null;
  const mailed = (report.recipients ?? []).map(({ name }) => name).toSorted((one, other) => one.localeCompare(other, "de"));
  return {
    subject: COPY.admin.spiel.ergebnis,
    consequence: COPY.admin.spiel.voids(numbersOf(voided)),
    ...(mailed.length === 0 ? {} : { facts: [{ label: COPY.admin.facts.mailTo, value: { record: formatList(mailed) } }] }),
    confirm: JSON.stringify({ voided, mailed }),
  };
}

/**
 * Saves the match editor's changes, answering the fixture's new version, which the editor takes as its own. The
 * version sent is the one the editor was read at: where the fixture has changed since, the write refuses the save as
 * stale (`version_stale`) rather than writing over it. A result carried over from the report stamps it adopted.
 *
 * Every save first asks the write's own dry run what it would delete, on the server, so no ordering of presses and no
 * failed or unfinished check on the page lets a deletion through unasked: a save deleting a later match's result is
 * held back with its question unless it carries the token of a question naming exactly those results. The write then
 * names them, and refuses in its own transaction where it would delete others, a result entered after the dry run
 * among them, so the write is the gate and the dry run only words its question. A dry run the write refuses is that
 * refusal, answered as the write's would be.
 */
export const saveSpiel = action({
  lane: "admin",
  name: "saveSpiel",
  input: SaveSpiel,
  ownWords: OWN_WORDS,
  // The boxes a field pattern's phrase lands on; every other refusal here is a sentence naming its field itself.
  paths: { sonderereignis: "changes.sonderereignis" },
  examples: { "changes.mietpreis": COPY.admin.spielort.mietpreisExample },
  run: async ({ id, version, adoptsBericht, changes, confirm }): Promise<ActionAnswer<number>> => {
    const payload = await sending(id, changes);
    if ("ok" in payload) return payload;
    const sent = { ...payload, version };

    const report = await spielePatchSpiel(id, sent, { dry_run: true });
    const question = questionOf(report);
    if (question !== null && question.confirm !== confirm) return { ok: false, ask: question };

    // The write deletes only the results confirmed, refusing where its own transaction finds others to delete.
    const confirmed = { ...sent, voided_results: report.voided_results };
    const written = await spielePatchSpiel(id, confirmed, adoptsBericht === null ? undefined : { adopts_bericht: adoptsBericht });

    // The other fixtures the write changed: a later round's occupant or result, or a side it released on the same
    // Spieltag. The match's own page says what changed there.
    const value = written.version;
    const changed = numbersOf([...written.advanced_to, ...written.released_sides]);
    return changed.length === 0 ? { ok: true, value } : { ok: true, value, note: COPY.admin.spiel.alsoChanged(changed) };
  },
});
