"use client";

import { useEffect, useEffectEvent, useState } from "react";

import { AdoptLine } from "@/kit/AdoptLine";
import { ComboBox } from "@/kit/ComboBox";
import { DateField } from "@/kit/DateField";
import { Dialog } from "@/kit/Dialog";
import { EditorPage } from "@/kit/EditorPage";
import { FieldPair } from "@/kit/FieldPair";
import { GroupHead } from "@/kit/GroupHead";
import { ScorePair } from "@/kit/ScorePair";
import { Select } from "@/kit/Select";
import { Switch } from "@/kit/Switch";
import { Table } from "@/kit/Table";
import { TextField } from "@/kit/TextField";
import { TimeField } from "@/kit/TimeField";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";
import { admitsShootOut } from "@/features/spiele/shootOut";

import { SpielortFelder } from "../../../../../SpielortFelder";
import { isNoShow, NO_SONDEREREIGNIS, takesNoResult } from "./spielValues";

import type { ActionAnswer } from "@/core/action";
import type { Copy, Words } from "@/core/copy";
import type { FLSaisonPhase, FLSonderereignis } from "@/core/generated/client/types";
import type { EditorSection } from "@/kit/EditorPage";
import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { TableRow } from "@/kit/Table";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SpielortRegeln } from "../../../../../spielortRegeln";
import type { SpielValues } from "./spielValues";

const WORDS = COPY.admin.spiel;
const ORT = COPY.admin.spielort;

/** A club a knockout match's side may be given by hand; one the write would not field carries why. */
export type Club = { id: string; name: string; note?: Copy };

/** The referee's proposal as „Übernehmen“ carries it into the result's fields, with the report's version it stamps. */
export type Adoption = { version: number; text: Copy; values: Partial<SpielValues> };

/** A record to book, a venue or a referee, and what the match pays them unless set otherwise. */
type Booking = { option: Option; price: number };

/** What a save sends: the changes, and the report's version where the result was carried over from it. */
type Sent = EditorSave<SpielValues> & { adoptsBericht: number | null };

/** Each field by its own label, as the Vorschau names the changes. */
const LABELS: Readonly<Record<keyof SpielValues, Copy>> = {
  team1: WORDS.team1,
  team2: WORDS.team2,
  datum: WORDS.datum,
  uhrzeit: WORDS.uhrzeit,
  spielort: ORT.object,
  mietpreis: ORT.mietpreis,
  schiedsrichter: COPY.shared.schiedsrichter,
  honorar: WORDS.honorar,
  hasResult: WORDS.ergebnis,
  tore1: COPY.shared.tore,
  tore2: COPY.shared.tore,
  shootOut1: WORDS.elfmeterschiessen,
  shootOut2: WORDS.elfmeterschiessen,
  sonderereignis: WORDS.sonderereignis,
  notiz: WORDS.notiz,
};

/** The fields whose change can move the bracket after the match, which a dry run asks about before the save. */
const MOVES_THE_BRACKET = ["team1", "team2", "hasResult", "tore1", "tore2", "shootOut1", "shootOut2", "sonderereignis"] as const;

/** One debounce for a dry run, settled before a hand reaches „Speichern“ after the last figure. */
const PREVIEW_DELAY_MS = 450;

const goals = (text: string) => (text === "" ? null : Number(text));

/**
 * The later matches whose results the present changes would delete, from the write's own dry run: a debounced
 * question per draft, its answer standing only over the draft it was asked for. No answer, while one is on its way
 * or where the run failed, asks nothing before the save, whose done line still names every match it moved.
 */
function useVoided(changes: Partial<SpielValues>, ask: (changes: Partial<SpielValues>) => Promise<ActionAnswer<readonly number[]>>) {
  const moving = MOVES_THE_BRACKET.some((key) => key in changes);
  const key = JSON.stringify(MOVES_THE_BRACKET.map((field) => changes[field] ?? null));
  const [answered, setAnswered] = useState<{ key: string; voided: readonly number[] } | null>(null);
  const run = useEffectEvent(async (asked: string) => {
    const answer = await ask(changes).catch(() => null);
    setAnswered({ key: asked, voided: answer?.ok === true ? answer.value : [] });
  });
  useEffect(() => {
    if (!moving) return undefined;
    const timer = setTimeout(() => void run(key), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [key, moving]);
  return moving && answered?.key === key ? answered.voided : [];
}

/**
 * The match editor: a knockout match's two clubs; the Ansetzung's day, time, venue and price, referee and fee; the
 * result, entered by the switch the board drew, its goals as one score, a shoot-out's pair appearing by itself on
 * level knockout goals, the Sonderereignis and the referee's proposal carried over by „Übernehmen“; the note; and the
 * report's goals and every party's answer, read-only. Saved together from the editor's bar, which asks first where the
 * save would delete a later match's result.
 */
export function SpielEditor({
  title,
  record,
  save,
  preview,
  phase,
  sides,
  quellen,
  clubs,
  spielorte,
  schiedsrichter,
  sonderereignisse,
  notizMax,
  required,
  report,
  adoption,
  answers,
  spielortAnlegen,
  spielortRegeln,
  closed,
}: {
  title: PageTitle;
  record: EditorRecord<SpielValues>;
  save: (sent: Sent) => Promise<ActionAnswer<number>>;
  preview: (sent: Sent) => Promise<ActionAnswer<readonly number[]>>;
  phase: FLSaisonPhase;
  /** Each side's club as stored, `null` while the side is open. */
  sides: { team1: Words | null; team2: Words | null };
  /** Where each side comes from in the bracket, in full, `null` where it follows nothing. */
  quellen: { team1: Copy | null; team2: Copy | null };
  /** A knockout match's clubs to pick its sides from; `null` on a group match, whose sides the draw sets. */
  clubs: readonly Club[] | null;
  spielorte: readonly Booking[];
  schiedsrichter: readonly Booking[];
  /** „Keines“ first, then each event, an event this fixture cannot take disabled with its reason. */
  sonderereignisse: readonly Option[];
  notizMax: number;
  /** Whether a booking's money is required beside it, read from the write on the server. */
  required: { mietpreis: boolean; honorar: boolean };
  /** The report's goals as rows, read-only; none while no report stands. */
  report: readonly TableRow[];
  adoption: Adoption | null;
  /** Each party's answer about the match as it stands. */
  answers: readonly TableRow[];
  spielortAnlegen: (formData: FormData) => Promise<ActionAnswer>;
  spielortRegeln: SpielortRegeln;
  /** Why the match is closed read-only: its season has finished, and the write refuses every change to it. */
  closed?: Copy;
}) {
  // „Übernehmen“ was pressed, so the save stamps the report adopted while the fields still hold its proposal.
  const [adopted, setAdopted] = useState(false);
  const holdsProposal = (draft: SpielValues) =>
    adoption !== null && Object.entries(adoption.values).every(([key, value]) => draft[key as keyof SpielValues] === value);
  const editor = useEditor(record, (change) =>
    save({
      ...change,
      adoptsBericht: adopted && adoption !== null && holdsProposal({ ...record.values, ...change.changes }) ? adoption.version : null,
    }),
  );
  const { draft, set, changes } = editor;
  const voided = useVoided(changes, (asked) => preview({ id: record.id, version: record.version, adoptsBericht: null, changes: asked }));
  // The create dialog, opened from the venue list's last entry with the name typed into the field; the dialog closes
  // this state itself when Next hides the page.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const clubName = (id: string | null): Words | null => {
    const club = id === null ? undefined : clubs?.find((each) => each.id === id);
    return club === undefined ? null : { record: club.name };
  };
  // Each side's field named by its club, as it now stands in the draft, and by its place while the side is open.
  const sideNames: readonly [Words, Words] = [
    (draft.team1 === record.values.team1 ? sides.team1 : clubName(draft.team1)) ?? WORDS.team1,
    (draft.team2 === record.values.team2 ? sides.team2 : clubName(draft.team2)) ?? WORDS.team2,
  ];
  const bothSides = draft.team1 !== null && draft.team2 !== null;
  const sonderereignis = draft.sonderereignis === NO_SONDEREREIGNIS ? null : (draft.sonderereignis as FLSonderereignis);
  // A result is entered on a match that was played, an abandoned one included; a no-show's is composed, and a match
  // called off or struck out carries none.
  const resultShown = !isNoShow(sonderereignis) && !takesNoResult(sonderereignis);
  const scored = resultShown && draft.hasResult;
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
  const withBegegnung = (rest: readonly [EditorSection, ...EditorSection[]]): readonly [EditorSection, ...EditorSection[]] =>
    begegnung === null ? rest : [begegnung, ...rest];

  return (
    <EditorPage
      title={title}
      lead={editor.count === 0 ? undefined : WORDS.changed([...new Set(Object.keys(changes).map((key) => LABELS[key as keyof SpielValues]))])}
      editor={editor}
      closed={closed}
      warning={() => (voided.length === 0 ? null : { subject: WORDS.ergebnis, consequence: WORDS.voids(voided) })}
      sections={withBegegnung([
        {
          id: "ansetzung",
          title: WORDS.ansetzung,
          fields: (
            <>
              {/* A day and its time are one value, sharing their row at every width. */}
              <FieldPair
                short="both"
                phone="pair">
                <DateField
                  label={WORDS.datum}
                  name="datum"
                  value={draft.datum}
                  onChange={(datum) => set("datum", datum)}
                />
                <TimeField
                  label={WORDS.uhrzeit}
                  name="uhrzeit"
                  value={draft.uhrzeit}
                  onChange={(uhrzeit) => set("uhrzeit", uhrzeit)}
                />
              </FieldPair>
              <FieldPair
                short="second"
                phone="stack">
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
                    width="C5"
                    kind="digits"
                    unit={COPY.shared.unit.euro}
                    isRequired={required.mietpreis}
                    value={draft.mietpreis}
                    onChange={(mietpreis) => set("mietpreis", mietpreis)}
                  />
                )}
              </FieldPair>
              {/* The booking is the Ansetzung's, the fee beside the referee as the price beside the venue. */}
              <FieldPair
                short="second"
                phone="stack">
                <ComboBox
                  label={COPY.shared.schiedsrichter}
                  name="schiedsrichter"
                  options={schiedsrichter.map((person) => person.option)}
                  value={draft.schiedsrichter}
                  onChange={(id) => {
                    set("schiedsrichter", id);
                    // A referee chosen brings their own fee, which the person may still change for this match.
                    const chosen = schiedsrichter.find((each) => each.option.id === id);
                    if (chosen !== undefined) set("honorar", String(chosen.price));
                  }}
                />
                {draft.schiedsrichter !== null && (
                  <TextField
                    label={WORDS.honorar}
                    name="honorar"
                    width="C5"
                    kind="digits"
                    unit={COPY.shared.unit.euro}
                    isRequired={required.honorar}
                    value={draft.honorar}
                    onChange={(honorar) => set("honorar", honorar)}
                  />
                )}
              </FieldPair>
              <Dialog
                title={COPY.shared.withObject(ORT.object, "create")}
                act={{ verb: "create", object: ORT.object }}
                action={spielortAnlegen}
                open={{ isOpen: creating, onOpenChange: setCreating }}>
                <SpielortFelder
                  regeln={spielortRegeln}
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
              {/* Revealing the result states the fact: on once a result is stored, and only once both sides stand. */}
              {resultShown && (
                <Switch
                  label={COPY.shared.withObject(WORDS.ergebnis, "enter")}
                  name="hasResult"
                  isSelected={draft.hasResult}
                  isDisabled={!bothSides}
                  onChange={(on) => set("hasResult", on)}
                  {...(bothSides ? {} : { description: WORDS.needsBothSides })}
                />
              )}
              {scored && (
                <ScorePair
                  label={COPY.shared.tore}
                  sides={sideNames}
                  names={["tore1", "tore2"]}
                  values={[draft.tore1, draft.tore2]}
                  onChange={(side, value) => set(side === 0 ? "tore1" : "tore2", value)}
                  isRequired={scored}
                />
              )}
              {/* By itself on level knockout goals, and optional: left empty, the match and the bracket after it wait. */}
              {shootOut && (
                <ScorePair
                  label={WORDS.elfmeterschiessen}
                  sides={sideNames}
                  names={["shootOut1", "shootOut2"]}
                  values={[draft.shootOut1, draft.shootOut2]}
                  onChange={(side, value) => set(side === 0 ? "shootOut1" : "shootOut2", value)}
                  isRequired={shootOutTyped}
                  {...(shootOutTyped ? {} : { consequence: WORDS.shootOutMissing })}
                />
              )}
              {adoption !== null && !holdsProposal(draft) && (
                <AdoptLine
                  text={adoption.text}
                  onAdopt={() => {
                    for (const [key, value] of Object.entries(adoption.values)) {
                      set(key as keyof SpielValues, value as SpielValues[keyof SpielValues]);
                    }
                    setAdopted(true);
                  }}
                />
              )}
              <Select
                label={WORDS.sonderereignis}
                name="sonderereignis"
                options={sonderereignisse}
                width="fit"
                value={draft.sonderereignis}
                onChange={(id) => {
                  if (id !== null) set("sonderereignis", id);
                }}
                {...(storedScore !== null && !resultShown ? { consequence: WORDS.resultDropped(storedScore) } : {})}
              />
            </>
          ),
        },
        {
          id: "notiz",
          title: WORDS.notiz,
          fields: (
            <TextField
              label={WORDS.notiz}
              name="notiz"
              width="W4"
              kind="text"
              maxLength={notizMax}
              value={draft.notiz}
              onChange={(notiz) => set("notiz", notiz)}
            />
          ),
        },
        {
          id: "spielbericht",
          title: WORDS.spielberichtUndBestaetigungen,
          fields: (
            <>
              <GroupHead text={WORDS.spielbericht} />
              <Table
                label={WORDS.spielbericht}
                nameLabel={COPY.shared.spieler}
                columns={[
                  { key: "event", label: WORDS.event },
                  { key: "minute", label: WORDS.minute, figures: true },
                  { key: "stand", label: WORDS.ergebnis, figures: true },
                ]}
                rows={report}
                empty={{ kind: "none", plural: COPY.shared.tore }}
                bare
                stack
              />
              <GroupHead text={WORDS.bestaetigungen} />
              <Table
                label={WORDS.bestaetigungen}
                nameLabel={WORDS.party}
                columns={[
                  { key: "answer", label: WORDS.answer },
                  { key: "proposal", label: WORDS.proposal },
                  { key: "reason", label: WORDS.reason },
                ]}
                rows={answers}
                empty={{ kind: "none", plural: WORDS.bestaetigungen }}
                bare
                stack
              />
            </>
          ),
        },
      ])}
    />
  );
}
