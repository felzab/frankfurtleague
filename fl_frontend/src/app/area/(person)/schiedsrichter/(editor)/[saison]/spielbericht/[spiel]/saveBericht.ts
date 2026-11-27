"use server";

import { z } from "zod";

import { action, blankIsNull, fault, numberBox } from "@/core/action";
import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { spielberichtePutSpielberichtBericht } from "@/core/generated/client/sdk";
import { SpielberichtePutSpielberichtBerichtBody, SpielberichtePutSpielberichtBerichtParams } from "@/core/generated/zod/inputs";
import { getOwnSpielbericht } from "@/features/spielberichte/queries";
import { admitsShootOut } from "@/features/spiele/result";

import { Cards, Goals } from "./berichtRules";
import { counted, requiredOf, UNKNOWN_PLAYER, valuesOf } from "./berichtValues";

import type { Fault, LaneAnswer } from "@/core/action";
import type { FLSpielberichtBerichtPayload, FLSpielberichtSchiedsrichterResponse } from "@/core/generated/client/types";

const { bericht, version } = SpielberichtePutSpielberichtBerichtBody.shape;
const { ergebnis_vorschlag: vorschlag, remarks } = bericht.shape;
const [shootOutShape] = vorschlag.shape.elfmeterschiessen.options;

const SaveBericht = z.object({
  id: SpielberichtePutSpielberichtBerichtParams.shape.spiel_id,
  // The report's version as the form read it, `null` where it read none.
  version,
  changes: z
    .object({
      sonderereignis: blankIsNull(vorschlag.shape.sonderereignis),
      shootOut1: numberBox(z.union([shootOutShape.shape.team1, z.null()])),
      shootOut2: numberBox(z.union([shootOutShape.shape.team2, z.null()])),
      scorers: Goals,
      cards: Cards,
      remarks: blankIsNull(remarks),
    })
    .partial(),
});

type Changes = z.output<typeof SaveBericht>["changes"];

/**
 * A list the form left as it was read, held to the rows' rules as a sent one is: a row whose player its side's new
 * club took out of it holds none, which reads „Pflichtfeld“ on that row's box. Nothing else of a stored row can
 * break a rule the write published.
 */
function storedRows<Row>(schema: z.ZodType<readonly Row[]>, rows: unknown, name: "scorers" | "cards", faults: Fault[]): readonly Row[] {
  const parsed = schema.safeParse(rows);
  if (parsed.success) return parsed.data;
  for (const issue of parsed.error.issues) faults.push(fault(["changes", name, ...issue.path].join("."), "required"));
  return [];
}

/**
 * The whole report as the write takes it: every field the form did not change as the report stands, since the write
 * replaces the whole block. A shoot-out stands only where the fixture takes one, a knockout match whose counted goals
 * are level and no no-show decided, and once either of its figures is typed both are required (`requiredOf`); one
 * typed before the goals moved off level is dropped, as the write would refuse it.
 */
function payloadOf(read: FLSpielberichtSchiedsrichterResponse, changes: Changes): FLSpielberichtBerichtPayload | LaneAnswer<never> {
  const stored = read.bericht;
  const shown = valuesOf(read);
  const faults: Fault[] = [];

  const sonderereignis = changes.sonderereignis === undefined ? (stored?.ergebnis_vorschlag.sonderereignis ?? null) : changes.sonderereignis;
  const goals = changes.scorers ?? storedRows(Goals, shown.scorers, "scorers", faults);
  const cardRows = changes.cards ?? storedRows(Cards, shown.cards, "cards", faults);
  const storedShootOut = stored?.ergebnis_vorschlag.elfmeterschiessen ?? null;
  const shootOut1 = changes.shootOut1 === undefined ? (storedShootOut?.team1 ?? null) : changes.shootOut1;
  const shootOut2 = changes.shootOut2 === undefined ? (storedShootOut?.team2 ?? null) : changes.shootOut2;

  const phase = read.spiel.saison_phase;
  for (const box of requiredOf({ scorers: goals, shootOut1, shootOut2, sonderereignis }, phase))
    faults.push(fault(`changes.${box}`, "required"));
  if (faults.length > 0) return { ok: false, faults };

  const score = counted(goals);
  const takesShootOut = admitsShootOut(phase, { tore: score.team1 }, { tore: score.team2 }, sonderereignis);

  return {
    ergebnis_vorschlag: {
      sonderereignis,
      elfmeterschiessen: takesShootOut && shootOut1 !== null && shootOut2 !== null ? { team1: shootOut1, team2: shootOut2 } : null,
    },
    // „Anonym“ is the null player the write reads as a player nobody named.
    scorers: goals.map((goal) => ({ ...goal, spieler_id: goal.spieler_id === UNKNOWN_PLAYER ? null : goal.spieler_id })),
    cards: cardRows.map((card) => ({ ...card, spieler_id: card.spieler_id === UNKNOWN_PLAYER ? null : card.spieler_id })),
    remarks: changes.remarks === undefined ? (stored?.remarks ?? null) : changes.remarks,
  };
}

/**
 * Writes the referee's report of one fixture, answering the report's new version, which the form takes as its own.
 * The version sent is the one the form read, `null` where it read no report: where the report changed since, an
 * administrator's adoption among it, the write refuses it as stale rather than replacing what the referee never saw.
 * The adoption into the fixture's result is the administrator's own save, never this one's.
 */
export const saveBericht = action({
  lane: "person",
  // The write authorises the booked referee in its own transaction.
  claim: "record",
  name: "saveBericht",
  input: SaveBericht,
  // The no-show's rule judges the whole block, so the backend names the block, which this form shows as the goals.
  paths: { bericht: "changes.scorers" },
  examples: {
    "changes.scorers.*.minute": AREA_COPY.schiedsrichter.spielbericht.minuteExample,
    "changes.cards.*.minute": AREA_COPY.schiedsrichter.spielbericht.minuteExample,
  },
  run: async ({ id, version: read, changes }): Promise<LaneAnswer<number>> => {
    const stands = await getOwnSpielbericht(id);
    if (stands === null) return { ok: false, reason: COPY.shared.failure.stale };
    const payload = payloadOf(stands, changes);
    if ("ok" in payload) return payload;

    const written = await spielberichtePutSpielberichtBericht(id, { version: read, bericht: payload });
    return { ok: true, value: written.version };
  },
});
