"use server";

import { z } from "zod";

import { action, blankIsNull, numberBox } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { refusedAs } from "@/core/errors";
import { formatList } from "@/core/format";
import { spielePatchSpiel } from "@/core/generated/client/sdk";
import { SpielePatchSpielBody, SpielePatchSpielParams } from "@/core/generated/zod/inputs";

import { getAdminSpiel } from "./queries";
import { admitsShootOut, isNoShow } from "./result";
import { NOBODY, takesNoResult, valuesOf } from "./spielValues";

import type { ActionAnswer, SaveQuestion } from "@/core/action";
import type { Copy } from "@/core/copy";
import type {
  Code,
  FLPatchSpielDataPayload,
  FLPatchSpielDataResponse,
  FLSpielJoinedAdmin,
  FLSpielVoidedErgebnis,
} from "@/core/generated/client/types";

const { shape } = SpielePatchSpielBody;
const [spielortShape] = shape.spielort.options;
const [schiedsrichterShape] = shape.schiedsrichter.options;
const [teamShape] = shape.team1.options;
const [shootOutShape] = shape.elfmeterschiessen.options;

/** A figure's box, which the editor may leave empty: no figure where the stored fixture holds none. */
const figure = (rule: z.ZodType<number>) => numberBox(z.union([rule, z.null()]));

const SaveSpiel = z.object({
  id: SpielePatchSpielParams.shape.spiel_id,
  version: shape.version,
  // The report's version the result was carried over from by „Übernehmen“, which the save stamps adopted.
  adoptsBericht: z.union([z.int().min(1), z.null()]),
  // The token of the question the person confirmed, naming what they confirmed the save would delete.
  confirm: z.string().optional(),
  changes: z
    .object({
      team1: z.union([teamShape.shape.team_id, z.null()]),
      team2: z.union([teamShape.shape.team_id, z.null()]),
      date: shape.date,
      time: shape.time,
      spielort: z.union([spielortShape.shape.spielort_id, z.null()]),
      mietpreis: figure(spielortShape.shape.mietpreis),
      // A referee's id, `NOBODY` for a booking naming nobody, or none.
      schiedsrichter: z.union([schiedsrichterShape.shape.schiedsrichter_id, z.literal(NOBODY)]),
      payment: figure(schiedsrichterShape.shape.payment),
      hasResult: z.boolean(),
      tore1: figure(z.int().min(0)),
      tore2: figure(z.int().min(0)),
      shootOut1: figure(shootOutShape.shape.team1),
      shootOut2: figure(shootOutShape.shape.team2),
      sonderereignis: blankIsNull(shape.sonderereignis),
      note: shape.note,
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
  const payment = changes.payment === undefined ? storedFigure(stored.payment) : changes.payment;
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
  if (schiedsrichter !== null && payment === null) fieldErrors["changes.payment"] = required;
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
    date: changes.date === undefined ? stored.date : changes.date,
    time: changes.time === undefined ? stored.time : changes.time,
    spielort: spielort === null || mietpreis === null ? null : { spielort_id: spielort, mietpreis },
    schiedsrichter:
      schiedsrichter === null || payment === null ? null : { schiedsrichter_id: schiedsrichter === NOBODY ? null : schiedsrichter, payment },
    team1,
    team2,
    // A hand-picked club no longer follows the side's source: the resolution keeps a side with none as it stands.
    team1_quelle: changes.team1 === undefined ? saved.team1_quelle : null,
    team2_quelle: changes.team2 === undefined ? saved.team2_quelle : null,
    elfmeterschiessen: shootOut,
    sonderereignis,
    note: changes.note === undefined ? stored.note : changes.note,
  };
}

/** The other fixtures a write moved or would move, each once, in their numbers' order. */
const numbersOf = (numbers: readonly number[]) => [...new Set(numbers)].toSorted((first, second) => first - second);

/** The fixture as stored, read for the fields the editor does not show, which the wholesale write sends as stored. */
async function sending(id: string, changes: Changes): Promise<ActionAnswer<never> | Omit<FLPatchSpielDataPayload, "version">> {
  const read = await getAdminSpiel(id);
  return read === null ? { ok: false, reason: COPY.shared.failure.stale } : payloadOf(read.spiel, changes);
}

/**
 * The question a save asks before it deletes a later match's result, `null` for a save deleting none, naming under its
 * sentence whom the save mails, each by the name the dry run reads off its own record, as every question naming its
 * act's mails does. Its token names each deleted result by its value as well as its match, and the parties in their
 * names' order, so a confirmation covers exactly what it was shown and an unchanged save is never asked twice. A save
 * that only mails asks nothing.
 */
function questionOf(report: FLPatchSpielDataResponse): SaveQuestion | null {
  const voided = report.voided_ergebnisse;
  if (voided.length === 0) return null;
  const mailed = (report.recipients ?? []).map(({ name }) => name).toSorted((one, other) => one.localeCompare(other, "de"));
  return {
    subject: COPY.spielplan.ergebnis,
    consequence: ADMIN_COPY.spiel.voids(numbersOf(voided.map(({ spiel_nr }) => spiel_nr))),
    ...(mailed.length === 0 ? {} : { facts: [{ label: ADMIN_COPY.facts.mailTo, value: { record: formatList(mailed) } }] }),
    confirm: JSON.stringify({ voided, mailed }),
  };
}

const VOIDED_STALE: ReadonlySet<Code> = new Set<Code>(["voided_results_stale"]);

/** Whether the write refused to delete a later result it was not named, a bare code naming none of them. */
const refusedToDelete = (failed: unknown): boolean => refusedAs(failed, VOIDED_STALE);

/**
 * Saves the match editor's changes, answering the fixture's new version, which the editor takes as its own. The
 * version sent is the one the editor was read at: where the fixture has changed since, the write refuses the save as
 * stale (`version_stale`) rather than writing over it. A result carried over from the report stamps it adopted.
 *
 * A first press sends the write naming no result to delete, so a save deleting none lands at once. The write refuses in
 * its own transaction to delete a later match's result it was not named, on the server, so no ordering of presses and
 * no failed or unfinished check on the page lets a deletion through unasked; its refusal names none, so only then is
 * the write's own dry run asked, to word the question. A press confirming a question asks the dry run afresh and
 * writes only while the question's token still names exactly what it finds, or while it finds nothing to delete,
 * naming those results to the write; a write refused even so, by a result entered after that dry run, asks again from
 * one more. So the write is the gate and the dry run only words its question. A dry run the write refuses is that
 * refusal, answered as the write's would be. A refused write whose dry run then finds nothing to delete answers the
 * stale-page line, the result it refused gone since.
 */
export const saveSpiel = action({
  lane: "admin",
  name: "saveSpiel",
  input: SaveSpiel,
  examples: { "changes.mietpreis": ADMIN_COPY.spielort.mietpreisExample },
  run: async ({ id, version, adoptsBericht, changes, confirm }): Promise<ActionAnswer<number>> => {
    const payload = await sending(id, changes);
    if ("ok" in payload) return payload;
    const sent = { ...payload, version };

    // A confirmed press is judged against a fresh dry run, the token covering the mails as well, which the write's
    // refusal does not judge: written with the results the token names, a party added since would be mailed unasked.
    let voided: FLSpielVoidedErgebnis[] = [];
    if (confirm !== undefined) {
      const report = await spielePatchSpiel(id, sent, { dry_run: true });
      const question = questionOf(report);
      if (question !== null && question.confirm !== confirm) return { ok: false, ask: question };
      voided = report.voided_ergebnisse;
    }

    let written: FLPatchSpielDataResponse;
    try {
      // The write deletes only the results named, refusing where its own transaction finds others to delete.
      written = await spielePatchSpiel(
        id,
        { ...sent, voided_ergebnisse: voided },
        adoptsBericht === null ? undefined : { adopts_bericht: adoptsBericht },
      );
    } catch (failed) {
      if (!refusedToDelete(failed)) throw failed;
      const question = questionOf(await spielePatchSpiel(id, sent, { dry_run: true }));
      // The result the write refused to delete gone since, a race between two writes: a second press saves.
      return question === null ? { ok: false, reason: COPY.shared.failure.stale } : { ok: false, ask: question };
    }

    // The other fixtures the write changed: a later round's occupant or result, or a side it released on the same
    // Spieltag. The match's own page says what changed there.
    const value = written.version;
    const changed = numbersOf([...written.advanced_to, ...written.released_sides]);
    return changed.length === 0 ? { ok: true, value } : { ok: true, value, note: ADMIN_COPY.spiel.alsoChanged(changed) };
  },
});
