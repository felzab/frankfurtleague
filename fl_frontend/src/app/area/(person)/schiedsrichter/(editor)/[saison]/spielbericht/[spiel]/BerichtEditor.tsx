"use client";

import { CardMark } from "@/kit/CardMark";
import { Checkbox } from "@/kit/Checkbox";
import { Segmented } from "@/kit/ChoiceButtons";
import { ComboBox } from "@/kit/ComboBox";
import { EditorPage } from "@/kit/EditorPage";
import { RecordRows } from "@/kit/RecordRows";
import { ScoreRows } from "@/kit/ScoreRows";
import { Section } from "@/kit/Section";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";
import { FLCardColour } from "@/core/generated/client/types";
import { admitsShootOut } from "@/features/spiele/shootOut";

import { counted, isNoShow, NO_SONDEREREIGNIS, UNKNOWN_SCORER } from "./berichtValues";

import type { ActionAnswer } from "@/core/action";
import type { Copy, RecordText, Words } from "@/core/copy";
import type { FLSaisonPhase, FLSonderereignis, FLSpielSide } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { RowCells } from "@/kit/RecordRows";
import type { ScoreOutcome } from "@/kit/ScoreRows";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { BerichtValues, Card, Goal } from "./berichtValues";

/** The cells of the fields a goal's row and a card's hold alike. */
type Cells = RowCells<Pick<Goal, "side" | "spieler_id" | "minute">>;

const WORDS = COPY.area.schiedsrichter.spielbericht;
const SPIEL = COPY.admin.spiel;
const MINUTE_UNIT = COPY.shared.unit.minute;

/**
 * A side of the fixture: its club's name, which the score's row and the no-show's entry carry, and its Kürzel, `null`
 * on a knockout slot no club fills yet, whose segment then carries its place's name.
 */
type Side = { name: Words; plaque: RecordText | null };

/** The minute's rule, the write's own pattern, which the server reads off the published contract. */
type MinuteRule = { pattern: string };

const COLOURS = Object.values(FLCardColour).map((colour) => ({ id: colour, label: WORDS.colour[colour], mark: <CardMark colour={colour} /> }));

/**
 * The referee's match report: the Ergebnis box, the goals counted from the goals entered and a shoot-out's pair on a
 * level knockout score, with the Sonderereignis under them; the goals, a row each; the cards, a row each, its colour
 * by the kit's card mark; and the remarks. Saved whole from the editor's bar. The report is a proposal: the result
 * stays the administrator's to save.
 */
export function BerichtEditor({
  title,
  lead,
  record,
  save,
  phase,
  sides,
  squads,
  minute,
  required,
  eigentor,
  remarksMax,
  sidesChanged,
  closed,
}: {
  title: PageTitle;
  /** When the match was played, under the title. */
  lead: Copy;
  record: EditorRecord<BerichtValues, number | null>;
  save: (sent: EditorSave<BerichtValues, number | null>) => Promise<ActionAnswer<number>>;
  phase: FLSaisonPhase;
  sides: Readonly<Record<FLSpielSide, Side>>;
  /** Each side's pupils to pick from, its squad's and any a stored row names beside them, each by number and name. */
  squads: Readonly<Record<FLSpielSide, readonly Option[]>>;
  minute: MinuteRule;
  /** Whether a row's minute and each list's player are required, read from the write's rules on the server. */
  required: { minute: boolean; goalPlayer: boolean; cardPlayer: boolean };
  /** An own goal's toggle, the server catalogue's word for it. */
  eigentor: Copy;
  remarksMax: number;
  /** A side fields another club than the report names: its rows naming the old club's pupils have lost them. */
  sidesChanged: boolean;
  /** Why the report is read-only: its season has finished, and the write refuses it. */
  closed?: Copy;
}) {
  const editor = useEditor(record, save);
  const { draft, set } = editor;

  const sonderereignis = draft.sonderereignis === NO_SONDEREREIGNIS ? null : (draft.sonderereignis as FLSonderereignis);
  const noShow = isNoShow(sonderereignis);
  const goals = counted(draft.scorers);
  const shootOut = !noShow && admitsShootOut(phase, { tore: goals.team1 }, { tore: goals.team2 }, sonderereignis);
  const shootOutTyped = draft.shootOut1 !== "" || draft.shootOut2 !== "";

  /** What the counted goals decide, after a shoot-out with its goals added; nothing while a shoot-out figure is missing. */
  const outcome = (): ScoreOutcome | null => {
    if (shootOut && (draft.shootOut1 === "" || draft.shootOut2 === "")) return null;
    const added = shootOut ? { team1: Number(draft.shootOut1), team2: Number(draft.shootOut2) } : null;
    const score = SPIEL.score(goals, added);
    const [one, other] = [goals.team1 + (added?.team1 ?? 0), goals.team2 + (added?.team2 ?? 0)];
    if (one === other) return { text: SPIEL.drawn(score), tone: "draw" };
    return { text: SPIEL.wins(one > other ? sides.team1.name : sides.team2.name, score), tone: "win" };
  };

  const choices = [
    { id: "team1", label: sides.team1.plaque ?? sides.team1.name },
    { id: "team2", label: sides.team2.plaque ?? sides.team2.name },
  ];
  const sonderereignisse: Option[] = [
    { id: NO_SONDEREREIGNIS, label: SPIEL.none },
    { id: "nichtantreten_team1", label: WORDS.nichtAngetreten(sides.team1.name) },
    { id: "nichtantreten_team2", label: WORDS.nichtAngetreten(sides.team2.name) },
    { id: "abgebrochen", label: SPIEL.abgebrochen },
  ];

  // The cells a goal's row and a card's share, each over the fields the two rows hold alike.
  /** A row's side: choosing another club empties its player, who plays for the club left. */
  const sideCell: Cells["lead"] = {
    field: "side",
    label: COPY.shared.facts.team,
    control: ({ row, label, error, change }) => (
      <Segmented
        label={label}
        labelHidden
        choices={choices}
        value={row.side}
        errorMessage={error}
        onChange={(side) => change({ side: side as FLSpielSide, spieler_id: null })}
      />
    ),
  };
  const minuteCell: Cells["figure"] = {
    field: "minute",
    label: SPIEL.minute,
    control: ({ row, name, label, change }) => (
      <TextField
        label={label}
        labelHidden
        name={name}
        width="C5"
        kind="minute"
        pattern={minute.pattern}
        example={WORDS.minuteExample}
        unit={MINUTE_UNIT}
        isRequired={required.minute}
        value={row.minute}
        onChange={(typed) => change({ minute: typed })}
      />
    ),
  };
  /** A row's player, from its side's squad; a goal's list opens on „Unbekannt“, a scorer nobody can name. */
  const playerCell = (first: readonly Option[], isRequired: boolean): Cells["main"] => ({
    field: "spieler_id",
    label: COPY.shared.spieler,
    control: ({ row, name, label, change }) => (
      <ComboBox
        label={label}
        labelHidden
        name={name}
        isRequired={isRequired}
        options={row.side === null ? [] : [...first, ...squads[row.side]]}
        value={row.spieler_id}
        onChange={(spielerId) => change({ spieler_id: spielerId })}
      />
    ),
  });

  const goalNoun = WORDS.goal;
  const cardNoun = WORDS.card;

  return (
    <EditorPage
      title={title}
      lead={lead}
      editor={editor}
      closed={closed}
      sections={[
        {
          id: "ergebnis",
          title: SPIEL.ergebnis,
          // A no-show's result is the league's award, which no goal decides.
          ...(noShow ? { note: SPIEL.byEvent } : {}),
          fields: (
            <>
              {!noShow && (
                <ScoreRows
                  sides={[sides.team1, sides.team2]}
                  tore={{ label: COPY.shared.tore, counted: [goals.team1, goals.team2] }}
                  // By itself on level knockout goals, and optional: left empty, the report proposes no winner.
                  shootOut={
                    shootOut
                      ? {
                          label: SPIEL.elfmeterschiessen,
                          head: SPIEL.afterElfmeterschiessen,
                          names: ["shootOut1", "shootOut2"],
                          values: [draft.shootOut1, draft.shootOut2],
                          onChange: (side, value) => set(side === 0 ? "shootOut1" : "shootOut2", value),
                          isRequired: shootOutTyped,
                        }
                      : null
                  }
                  outcome={outcome()}
                  {...(shootOut && !shootOutTyped ? { consequence: SPIEL.shootOutMissing } : {})}
                />
              )}
              <Select
                label={SPIEL.sonderereignis}
                name="sonderereignis"
                options={sonderereignisse}
                width="fit"
                value={draft.sonderereignis}
                onChange={(id) => {
                  if (id !== null) set("sonderereignis", id);
                }}
              />
            </>
          ),
        },
        {
          id: "tore",
          block: (
            <Section
              title={COPY.shared.tore}
              {...(sidesChanged ? { note: WORDS.sidesChanged } : {})}
              list={
                <RecordRows<Goal>
                  label={COPY.shared.tore}
                  name="scorers"
                  rows={draft.scorers}
                  onChange={(rows) => set("scorers", rows)}
                  blank={{ side: null, spieler_id: null, minute: "", eigentor: false }}
                  rowLabel={(number) => WORDS.numbered(goalNoun, number)}
                  add={COPY.shared.withObject(goalNoun, "enter")}
                  remove={COPY.shared.withObject(goalNoun, "remove")}
                  // A no-show takes no goal; rows entered before it was chosen stay, to be removed, and the send refuses them.
                  {...(noShow ? { locked: COPY.shared.field.without(COPY.shared.tore) } : {})}
                  errors={editor.fieldErrors}
                  cells={{
                    lead: sideCell,
                    figure: minuteCell,
                    main: playerCell([{ id: UNKNOWN_SCORER, label: WORDS.unknown }], required.goalPlayer),
                    beside: {
                      field: "eigentor",
                      label: eigentor,
                      control: ({ row, name, label, change }) => (
                        <Checkbox
                          label={label}
                          name={name}
                          isSelected={row.eigentor}
                          onChange={(own) => change({ eigentor: own })}
                        />
                      ),
                    },
                  }}
                />
              }
            />
          ),
        },
        {
          id: "karten",
          block: (
            <Section
              title={WORDS.cards}
              list={
                <RecordRows<Card>
                  label={WORDS.cards}
                  name="cards"
                  rows={draft.cards}
                  onChange={(rows) => set("cards", rows)}
                  blank={{ side: null, spieler_id: null, minute: "", colour: null }}
                  rowLabel={(number) => WORDS.numbered(cardNoun, number)}
                  add={COPY.shared.withObject(cardNoun, "enter")}
                  remove={COPY.shared.withObject(cardNoun, "remove")}
                  errors={editor.fieldErrors}
                  cells={{
                    lead: sideCell,
                    figure: minuteCell,
                    main: playerCell([], required.cardPlayer),
                    below: {
                      field: "colour",
                      label: cardNoun,
                      control: ({ row, label, error, change }) => (
                        <Segmented
                          label={label}
                          labelHidden
                          choices={COLOURS}
                          value={row.colour}
                          errorMessage={error}
                          onChange={(colour) => change({ colour: colour as FLCardColour })}
                        />
                      ),
                    },
                  }}
                />
              }
            />
          ),
        },
        {
          id: "bemerkungen",
          title: WORDS.remarks,
          fields: (
            <TextField
              label={WORDS.remarks}
              labelHidden
              name="remarks"
              width="W4"
              kind="text"
              description={COPY.admin.noNames}
              maxLength={remarksMax}
              value={draft.remarks}
              onChange={(remarks) => set("remarks", remarks)}
            />
          ),
        },
      ]}
    />
  );
}
