"use client";

import { useState } from "react";

import { AdoptLine } from "@/kit/AdoptLine";
import { AnswerRows } from "@/kit/AnswerRows";
import { CardActRow } from "@/kit/Card";
import { ComboBox } from "@/kit/ComboBox";
import { DateField } from "@/kit/DateField";
import { Dialog } from "@/kit/Dialog";
import { EditorPage } from "@/kit/EditorPage";
import { FieldPair } from "@/kit/FieldPair";
import { ScoreRows } from "@/kit/ScoreRows";
import { Section } from "@/kit/Section";
import { Select } from "@/kit/Select";
import { Switch } from "@/kit/Switch";
import { Table } from "@/kit/Table";
import { TextField } from "@/kit/TextField";
import { TimeField } from "@/kit/TimeField";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";
import { admitsShootOut, isNoShow, scoreOutcome } from "@/features/spiele/result";

import { SpielortFields } from "../../../../../SpielortFields";
import { adoptsBerichtOf, NO_SONDEREREIGNIS, takesNoResult } from "./spielValues";

import type { ActionAnswer } from "@/core/action";
import type { Copy, LockReason, Words } from "@/core/copy";
import type { FLSaisonPhase, FLSonderereignis } from "@/core/generated/client/types";
import type { AnswerRow } from "@/kit/AnswerRows";
import type { CardActRowProps } from "@/kit/Card";
import type { ChipProps } from "@/kit/Chip";
import type { EditorPart, EditorSection } from "@/kit/EditorPage";
import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { ScoreOutcome, ScoreSide } from "@/kit/ScoreRows";
import type { TableHead, TableRow } from "@/kit/Table";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { Route } from "next";
import type { SpielortRules } from "../../../../../spielortRules";
import type { Proposal, SpielValues } from "./spielValues";

const WORDS = COPY.admin.spiel;
const ORT = COPY.admin.spielort;

/** A club a knockout match's side may be given by hand, with its Kürzel; one the write would not field carries why. */
export type Club = { id: string; name: string; shorthand: string; note?: Copy };

/** The referee's proposal with the line saying it, „Laut Spielbericht 3:1“, beside „Übernehmen“. */
export type Adoption = Proposal & { text: Copy };

/** A record to book, a venue or a referee, and what the match pays them unless set otherwise. */
type Booking = { option: Option; price: number };

/** What the editor holds: the match's fields, and whether „Übernehmen“ was pressed. */
type Draft = SpielValues & { adopting: boolean };

/** What a save sends: the changes, and the report's version where the result was carried over from it. */
type Sent = EditorSave<SpielValues> & { adoptsBericht: number | null };

const goals = (text: string) => (text === "" ? null : Number(text));

/**
 * The match editor: a knockout match's two clubs; the Ansetzung's day, time, venue and price, referee and fee; the
 * result, entered by a switch, a side per row, a shoot-out's column appearing by itself on level
 * knockout goals, and the referee's proposal carried over by „Übernehmen“; the note; the Sonderereignis, in a box of
 * its own; the report's goals and every party's answer, read-only; and last a link to each side's line-up, which its
 * own page saves. Saved together from the editor's bar; a save that would delete a later match's result the server
 * holds back with its question, which the bar asks. Until the season's start the result's switch and figures stand
 * locked and „Übernehmen“ is not offered, the write taking no result before it.
 */
export function SpielEditor({
  title,
  chip,
  preview,
  record,
  save,
  phase,
  begun,
  sides,
  quellen,
  clubs,
  spielorte,
  schiedsrichter,
  sonderereignisse,
  noteMax,
  required,
  report,
  adoption,
  answers,
  aufstellungen,
  createSpielort,
  spielortRules,
  closed,
  spielPage,
}: {
  title: PageTitle;
  /** The match's state after the title, as the league's „Spiele“ list shows it; absent for a match simply set. */
  chip?: ChipProps;
  /** The line under the title: the match as it is stored, read on the server. */
  preview: Copy;
  record: EditorRecord<SpielValues>;
  save: (sent: Sent) => Promise<ActionAnswer<number>>;
  phase: FLSaisonPhase;
  /** The season has started: before it, the write takes no result, so the result's fields stand locked. */
  begun: boolean;
  /** Each side's club as stored, by its name and its plaque, `null` while the side is open. */
  sides: { team1: ScoreSide | null; team2: ScoreSide | null };
  /** Where each side comes from in the bracket, in full, `null` where it follows nothing. */
  quellen: { team1: Copy | null; team2: Copy | null };
  /** A knockout match's clubs to pick its sides from; `null` on a group match, whose sides the draw sets. */
  clubs: readonly Club[] | null;
  spielorte: readonly Booking[];
  schiedsrichter: readonly Booking[];
  /** „Keines“ first, then each event, an event this fixture cannot take disabled with its reason. */
  sonderereignisse: readonly Option[];
  noteMax: number;
  /** Whether a booking's money is required beside it, read from the write on the server. */
  required: { mietpreis: boolean; payment: boolean };
  /** The report's goals as rows, read-only, none while no report stands, under the head the page's wait draws too. */
  report: { head: TableHead; rows: readonly TableRow[] };
  adoption: Adoption | null;
  /** Each party's answer about the match as it stands. */
  answers: readonly AnswerRow[];
  /** A row per side whose line-up the match owes, leading to it, „Fehlt“ under it where none is stored, with its chip. */
  aufstellungen: ReadonlyArray<CardActRowProps & { id: string }>;
  createSpielort: (formData: FormData) => Promise<ActionAnswer>;
  spielortRules: SpielortRules;
  /** Why the match is closed read-only: its season has finished, and the write refuses every change to it. */
  closed?: Copy;
  /** The match's public page, where the public may read its season: the strip's way there. */
  spielPage?: Route;
}) {
  // „Übernehmen“ pressed is one of the draft's changes, so it counts, holds the way back and goes with a discard like any
  // field, even where the fields already hold the proposal; the save stamps the report with it.
  const editor = useEditor<Draft>(
    { ...record, values: { ...record.values, adopting: false } },
    ({ changes: { adopting, ...changes }, ...change }) =>
      save({ ...change, changes, adoptsBericht: adoptsBerichtOf(adoption, adopting === true, { ...record.values, ...changes }) }),
  );
  const { draft } = editor;
  const set = <Key extends keyof SpielValues & string>(key: Key, value: Draft[Key]) => {
    editor.set(key, value);
    // A field the proposal sets, changed after „Übernehmen“, takes the press back: the save would stamp nothing.
    if (adoption !== null && key in adoption.values) editor.set("adopting", false);
  };
  // The create dialog, opened from the venue list's last entry with the name typed into the field; the dialog closes
  // this state itself when Next hides the page.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const clubOf = (id: string | null) => (id === null ? undefined : clubs?.find((each) => each.id === id));
  // Each side's field named by its club, as it now stands in the draft, a club picked by hand with the plaque the
  // picker's list carries for it, and by its place while the side is open.
  const sideOf = (side: "team1" | "team2"): ScoreSide => {
    if (draft[side] === record.values[side] && sides[side] !== null) return sides[side];
    const club = clubOf(draft[side]);
    return club === undefined ? { name: WORDS[side], plaque: null } : { name: { record: club.name }, plaque: { record: club.shorthand } };
  };
  const scoreSides: readonly [ScoreSide, ScoreSide] = [sideOf("team1"), sideOf("team2")];
  const sideNames: readonly [Words, Words] = [scoreSides[0].name, scoreSides[1].name];
  const bothSides = draft.team1 !== null && draft.team2 !== null;
  const sonderereignis = draft.sonderereignis === NO_SONDEREREIGNIS ? null : (draft.sonderereignis as FLSonderereignis);
  // A result is entered on a match that was played, an abandoned one included; a no-show's is composed, and a match
  // called off or struck out carries none.
  const resultShown = !isNoShow(sonderereignis) && !takesNoResult(sonderereignis);
  const scored = resultShown && draft.hasResult;
  // Before the start the write takes no result: the fields stand locked, and a result stored earlier stands as it is.
  const resultLocked = !begun;
  const locks: LockReason[] = resultLocked ? ["untilStart"] : [];
  const shootOut = scored && admitsShootOut(phase, { tore: goals(draft.tore1) }, { tore: goals(draft.tore2) }, sonderereignis) && bothSides;
  const shootOutTyped = draft.shootOut1 !== "" || draft.shootOut2 !== "";
  const storedScore =
    record.values.hasResult && record.values.tore1 !== "" && record.values.tore2 !== ""
      ? WORDS.score(
          { team1: Number(record.values.tore1), team2: Number(record.values.tore2) },
          record.values.shootOut1 === "" || record.values.shootOut2 === ""
            ? null
            : { team1: Number(record.values.shootOut1), team2: Number(record.values.shootOut2) },
        )
      : null;

  /**
   * What the typed goals decide, after a shoot-out with its goals added: who wins and by what, or a draw; nothing
   * while a figure the decision reads is missing.
   */
  const outcomeOf = (tore: readonly [string, string], shootOutGoals: readonly [string, string] | null): ScoreOutcome | null => {
    if (tore.includes("") || shootOutGoals?.includes("") === true) return null;
    const scored = { team1: Number(tore[0]), team2: Number(tore[1]) };
    const added = shootOutGoals === null ? null : { team1: Number(shootOutGoals[0]), team2: Number(shootOutGoals[1]) };
    return scoreOutcome(scored, added, sideNames);
  };

  /** A side's club picker: the clubs of the season, the other side's own and any the write would not field disabled. */
  const sidePicker = (side: "team1" | "team2", other: string | null) => (
    <Select
      label={WORDS[side]}
      name={side}
      options={(clubs ?? []).map((club): Option => {
        if (club.note !== undefined) return { id: club.id, label: { record: club.name }, isDisabled: true, note: club.note };
        return club.id === other
          ? { id: club.id, label: { record: club.name }, isDisabled: true, note: WORDS.onSpieltag }
          : { id: club.id, label: { record: club.name } };
      })}
      value={draft[side]}
      onChange={(id) => set(side, id)}
      {...(draft[side] !== record.values[side] && quellen[side] !== null ? { consequence: WORDS.replacesQuelle(quellen[side]) } : {})}
    />
  );

  // First on a knockout match, the clubs being what the rest of the match is about; a group match has none to pick.
  const begegnung: EditorSection | null =
    clubs === null
      ? null
      : {
          id: "begegnung",
          title: WORDS.begegnung,
          fields: (
            <>
              {sidePicker("team1", draft.team2)}
              {sidePicker("team2", draft.team1)}
            </>
          ),
        };
  // Last, each side's line-up, which its own page saves: its rows lead there, edge to edge in a box of their own.
  const lineups =
    aufstellungen.length === 0
      ? []
      : [
          {
            id: "aufstellungen",
            block: (
              <Section
                title={COPY.area.team.aufstellung.plural}
                list={aufstellungen.map(({ id, ...row }) => (
                  <CardActRow
                    key={id}
                    {...row}
                  />
                ))}
              />
            ),
          },
        ];
  const framed = (rest: readonly [EditorPart, ...EditorPart[]]): readonly [EditorPart, ...EditorPart[]] =>
    begegnung === null ? [...rest, ...lineups] : [begegnung, ...rest, ...lineups];

  return (
    <EditorPage
      title={title}
      chip={chip}
      lead={preview}
      editor={editor}
      closed={closed}
      locks={locks}
      {...(spielPage === undefined ? {} : { link: { href: spielPage, label: COPY.shared.toSpiel } })}
      sections={framed([
        {
          id: "ansetzung",
          title: WORDS.ansetzung,
          fields: (
            <>
              {/* A day and its time are one value, sharing their row at every width. */}
              <FieldPair>
                <DateField
                  label={WORDS.date}
                  name="date"
                  value={draft.date}
                  onChange={(date) => set("date", date)}
                />
                <TimeField
                  label={WORDS.time}
                  name="time"
                  value={draft.time}
                  onChange={(time) => set("time", time)}
                />
              </FieldPair>
              <ComboBox
                label={ORT.object}
                name="spielort"
                options={spielorte.map((spielort) => spielort.option)}
                value={draft.spielort}
                onChange={(spielort) => {
                  set("spielort", spielort);
                  // A venue chosen brings its own price, which the person may still change for this match.
                  const chosen = spielorte.find((each) => each.option.id === spielort);
                  if (chosen !== undefined) set("mietpreis", String(chosen.price));
                }}
                create={{
                  label: ORT.createEntry,
                  onCreate: (typed) => {
                    setNewName(typed);
                    setCreating(true);
                  },
                }}
              />
              {/* Revealed with the venue that decides it: a match at a venue pays for it, one with none pays nothing. */}
              {draft.spielort !== null && (
                <TextField
                  label={ORT.mietpreis}
                  name="mietpreis"
                  holds={5}
                  kind="digits"
                  unit={COPY.shared.unit.euro}
                  isRequired={required.mietpreis}
                  value={draft.mietpreis}
                  onChange={(mietpreis) => set("mietpreis", mietpreis)}
                />
              )}
              {/* The booking is the Ansetzung's, the fee under the referee as the price under the venue. */}
              <ComboBox
                label={COPY.shared.schiedsrichter}
                name="schiedsrichter"
                options={schiedsrichter.map((person) => person.option)}
                value={draft.schiedsrichter}
                onChange={(id) => {
                  set("schiedsrichter", id);
                  // A referee chosen brings their own fee, which the person may still change for this match.
                  const chosen = schiedsrichter.find((each) => each.option.id === id);
                  if (chosen !== undefined) set("payment", String(chosen.price));
                }}
              />
              {draft.schiedsrichter !== null && (
                <TextField
                  label={COPY.admin.payment}
                  name="payment"
                  holds={5}
                  kind="digits"
                  unit={COPY.shared.unit.euro}
                  isRequired={required.payment}
                  value={draft.payment}
                  onChange={(payment) => set("payment", payment)}
                />
              )}
              <Dialog
                title={COPY.shared.withObject(ORT.object, "create")}
                act={{ verb: "create", object: ORT.object }}
                action={createSpielort}
                open={{ isOpen: creating, onOpenChange: setCreating }}>
                <SpielortFields
                  rules={spielortRules}
                  name={newName}
                />
              </Dialog>
            </>
          ),
        },
        {
          id: "ergebnis",
          title: WORDS.ergebnis,
          fields: (
            <>
              {/* Revealing the result states the fact: on once a result is stored, and only once both sides stand. A
                  Sonderereignis composing the result, or leaving the match without one, closes it with that reason. */}
              <Switch
                label={COPY.shared.withObject(WORDS.ergebnis, "enter")}
                name="hasResult"
                isSelected={resultShown && draft.hasResult}
                isDisabled={!bothSides || !resultShown}
                isLocked={resultLocked}
                onChange={(on) => set("hasResult", on)}
                {...(resultLocked
                  ? {}
                  : !resultShown
                    ? { description: WORDS.byEvent }
                    : bothSides
                      ? {}
                      : { description: WORDS.needsBothSides })}
              />
              {scored && (
                <ScoreRows
                  sides={scoreSides}
                  tore={{
                    label: COPY.shared.tore,
                    names: ["tore1", "tore2"],
                    values: [draft.tore1, draft.tore2],
                    onChange: (side, value) => set(side === 0 ? "tore1" : "tore2", value),
                    isRequired: true,
                    isLocked: resultLocked,
                  }}
                  // By itself on level knockout goals, and optional: left empty, the match and the bracket after it wait.
                  shootOut={
                    shootOut
                      ? {
                          label: WORDS.elfmeterschiessen,
                          head: WORDS.afterElfmeterschiessen,
                          names: ["shootOut1", "shootOut2"],
                          values: [draft.shootOut1, draft.shootOut2],
                          onChange: (side, value) => set(side === 0 ? "shootOut1" : "shootOut2", value),
                          isRequired: shootOutTyped,
                          isLocked: resultLocked,
                        }
                      : null
                  }
                  outcome={outcomeOf([draft.tore1, draft.tore2], shootOut ? [draft.shootOut1, draft.shootOut2] : null)}
                  {...(shootOut && !shootOutTyped ? { consequence: WORDS.shootOutMissing } : {})}
                />
              )}
              {/* Offered until pressed, where the fields already hold the proposal too: only the press adopts it. */}
              {adoption !== null && !resultLocked && !draft.adopting && (
                <AdoptLine
                  text={adoption.text}
                  onAdopt={() => {
                    for (const [key, value] of Object.entries(adoption.values)) {
                      editor.set(key as keyof SpielValues, value);
                    }
                    editor.set("adopting", true);
                  }}
                />
              )}
            </>
          ),
        },
        {
          id: "note",
          title: WORDS.note,
          fields: (
            <TextField
              label={WORDS.note}
              labelHidden
              name="note"
              kind="paragraph"
              maxLength={noteMax}
              value={draft.note}
              onChange={(note) => set("note", note)}
            />
          ),
        },
        // What happened beyond the play, which decides whether the Ergebnis box takes a result at all.
        {
          id: "sonderereignis",
          title: WORDS.sonderereignis,
          fields: (
            <Select
              label={WORDS.sonderereignis}
              labelHidden
              name="sonderereignis"
              options={sonderereignisse}
              value={draft.sonderereignis}
              onChange={(id) => {
                if (id !== null) set("sonderereignis", id);
              }}
              {...(storedScore !== null && !resultShown ? { consequence: WORDS.resultDropped(storedScore) } : {})}
            />
          ),
        },
        {
          id: "spielbericht",
          // Its own section, the table edge to edge in its box, so the table's width is the box's, which picks its form.
          block: (
            <Section
              title={WORDS.spielbericht}
              list={
                <Table
                  label={WORDS.spielbericht}
                  {...report.head}
                  rows={report.rows}
                  empty={{ kind: "none", plural: COPY.shared.tore }}
                  bare
                  stack
                />
              }
            />
          ),
        },
        {
          id: "confirmations",
          title: WORDS.confirmations,
          fields: (
            <AnswerRows
              label={WORDS.confirmations}
              rows={answers}
              empty={{ kind: "none", plural: WORDS.confirmations }}
            />
          ),
        },
      ])}
    />
  );
}
