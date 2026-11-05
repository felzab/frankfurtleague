"use client";

import { useState } from "react";

import { Checkbox } from "@/kit/Checkbox";
import { ToggleBoxes } from "@/kit/ChoiceButtons";
import { ComboBox } from "@/kit/ComboBox";
import { DateField } from "@/kit/DateField";
import { EditorPage } from "@/kit/EditorPage";
import { Facts } from "@/kit/Facts";
import { FieldPair } from "@/kit/FieldPair";
import { SectionAct } from "@/kit/SectionAct";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";
import { formatDatum, formatNumber } from "@/core/format";
import { FLSpielerStufe } from "@/core/generated/client/types";

import type { ActionAnswer } from "@/core/action";
import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { FLSpielplanShape } from "@/core/generated/client/types";
import type { SaisonRequired } from "@/features/saisons/required";
import type { ChipProps } from "@/kit/Chip";
import type { DangerAct, EditorSection } from "@/kit/EditorPage";
import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SaisonValues } from "./saisonValues";

const WORDS = COPY.admin.saison;
const SPIELPLAN = COPY.page.spielplan;
const TEAM = COPY.account.entries.facts.team;

const TIEBREAK: readonly Option[] = [
  { id: "tordifferenz", label: WORDS.tordifferenz },
  { id: "direkter_vergleich", label: WORDS.direkterVergleich },
];

const STUFEN = Object.values(FLSpielerStufe).map((stufe) => ({ id: stufe, label: WORDS.stufe[stufe] }));

/** One club of the season as the swap and the replacement list it, graded as each write judges it. */
export type SaisonClub = {
  id: string;
  name: string;
  gruppe: string;
  /** A group match of it has taken place, which closes every swap pair it stands in. */
  groupTakenPlace: boolean;
  /** Any match of it has taken place, which closes its replacement. */
  takenPlace: boolean;
};

/** What the season holds beyond its fields: where it stands, its draw, and what the editor's acts read. */
export type SaisonFacts = {
  /** The season's start has passed, which fixes its scoring, its seeding and its clubs. */
  begun: boolean;
  /** A match of it has taken place, which fixes its start. */
  takenPlace: boolean;
  /** The site shows this season. */
  isCurrent: boolean;
  spielplan: { spieltage: number; spiele: number; drawnOn: CalendarDay } | null;
};

/** The acts the editor's sections and its danger rows press, each a server action naming its season. */
export type SaisonActs = {
  draw: (input: { saison_id: string }) => Promise<ActionAnswer>;
  recreate: (input: { saison_id: string; holder: string }) => Promise<ActionAnswer>;
  undraw: (input: { saison_id: string; holder: string }) => Promise<ActionAnswer>;
  activate: (input: { saison_id: string; holder: string }) => Promise<ActionAnswer>;
  swap: (input: { saison_id: string; team1_id: string; team2_id: string }) => Promise<ActionAnswer>;
  replace: (input: { saison_id: string; team_id: string; incoming_team_id: string }) => Promise<ActionAnswer>;
};

/** A club as a picker lists it, „Lessing · Gruppe A“, closed with its reason where `closed` says so. */
const optionOf = (club: SaisonClub, closed: boolean): Option =>
  closed
    ? { id: club.id, label: { record: `${club.name} · ${COPY.shared.season.gruppe(club.gruppe)}` }, isDisabled: true, note: WORDS.tookPlace }
    : { id: club.id, label: { record: `${club.name} · ${COPY.shared.season.gruppe(club.gruppe)}` } };

/** The group swap: two clubs of different groups, a pair closed where a group match of either has taken place. */
function Swap({ saison, clubs, swap, locked }: { saison: string; clubs: readonly SaisonClub[]; swap: SaisonActs["swap"]; locked: boolean }) {
  const [first, setFirst] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);
  const chosen = clubs.find((club) => club.id === first);
  // A swap within one group exchanges nothing: the second club is one of another group.
  const partners = chosen === undefined ? clubs : clubs.filter((club) => club.gruppe !== chosen.gruppe);
  return (
    <SectionAct
      label={COPY.shared.withObject(WORDS.gruppen, "swap")}
      isDisabled={locked || first === null || second === null}
      run={async () => (first === null || second === null ? { ok: false } : swap({ saison_id: saison, team1_id: first, team2_id: second }))}>
      <ComboBox
        label={WORDS.swapFirst}
        options={clubs.map((club) => optionOf(club, club.groupTakenPlace))}
        isDisabled={locked}
        value={first}
        onChange={(id) => {
          setFirst(id);
          setSecond(null);
        }}
      />
      <ComboBox
        label={WORDS.swapSecond}
        options={partners.map((club) => optionOf(club, club.groupTakenPlace))}
        isDisabled={locked}
        value={second}
        onChange={setSecond}
      />
    </SectionAct>
  );
}

/** The replacement: a club leaving the season, closed once a match of it has taken place, and the club taking over. */
function Replacement({
  saison,
  clubs,
  incoming,
  replace,
  locked,
}: {
  saison: string;
  clubs: readonly SaisonClub[];
  incoming: readonly { id: string; name: string }[];
  replace: SaisonActs["replace"];
  locked: boolean;
}) {
  const [out, setOut] = useState<string | null>(null);
  const [into, setInto] = useState<string | null>(null);
  const leaving = clubs.find((club) => club.id === out);
  const arriving = incoming.find((club) => club.id === into);
  const consequence =
    leaving === undefined || arriving === undefined
      ? undefined
      : WORDS.replaceConsequence({ record: arriving.name }, { record: leaving.name }, leaving.gruppe);
  return (
    <SectionAct
      label={COPY.shared.withObject(TEAM, "replace")}
      isDisabled={locked || consequence === undefined}
      // Asked only once both clubs are chosen, the button staying closed until then.
      confirm={{ verb: "replace", subject: TEAM, consequence: consequence ?? COPY.shared.noValue, tone: "primary" }}
      run={async () => (out === null || into === null ? { ok: false } : replace({ saison_id: saison, team_id: out, incoming_team_id: into }))}>
      <ComboBox
        label={WORDS.outgoing}
        options={clubs.map((club) => optionOf(club, club.takenPlace))}
        isDisabled={locked}
        value={out}
        onChange={setOut}
      />
      <ComboBox
        label={WORDS.incoming}
        options={incoming.map((club) => ({ id: club.id, label: { record: club.name } }))}
        isDisabled={locked}
        value={into}
        onChange={setInto}
        consequence={consequence}
      />
    </SectionAct>
  );
}

/**
 * The season editor: its dates, its rules and its two windows, saved together from the editor's bar; then its draw,
 * its group swap and its replacement, each an act of its own box; its irreversible acts, the draw's regeneration and
 * removal and the switch of the site onto it, in the danger rows behind the passkey touch.
 */
export function SaisonEditor({
  saison,
  title,
  chip,
  record,
  save,
  required,
  facts,
  shapes,
  clubs,
  incoming,
  holder,
  acts,
  closed,
}: {
  saison: string;
  title: PageTitle;
  chip: ChipProps;
  record: EditorRecord<SaisonValues>;
  save: (change: EditorSave<SaisonValues>) => Promise<ActionAnswer<number>>;
  /** Which boxes the season write requires, read from its schema on the server. */
  required: SaisonRequired;
  facts: SaisonFacts;
  /** Every shape the draw admits beside the season's other rules, which the qualifiers are offered from. */
  shapes: readonly FLSpielplanShape[];
  clubs: readonly SaisonClub[];
  incoming: readonly { id: string; name: string }[];
  /** The address the page was drawn for, which an act behind the passkey touch posts. */
  holder: string;
  acts: SaisonActs;
  /** Why the season is closed read-only: it has finished. */
  closed?: Copy;
}) {
  const editor = useEditor(record, save);
  const { draft, set } = editor;
  const isClosed = closed !== undefined;
  const drawn = facts.spielplan !== null;

  // The qualifiers per group the typed counts admit, as the draw judges them; the stored count stays listed, so the
  // box never empties under its value.
  const offered = shapes
    .filter((shape) => String(shape.number_of_gruppen) === draft.gruppen && String(shape.teams_per_gruppe) === draft.teamsPerGruppe)
    .map((shape) => String(shape.qualifiers_per_gruppe));
  const qualifiers = [...new Set([...offered, draft.qualifiers])]
    .filter((value) => value !== "")
    .toSorted((one, other) => Number(one) - Number(other))
    .map((value): Option => ({ id: value, label: { record: value } }));

  const touch = { held: true, holder };
  const of = { saison_id: saison, holder };

  const sections: [EditorSection, ...EditorSection[]] = [
    {
      id: "zeitraum",
      title: WORDS.zeitraum,
      ...(facts.takenPlace ? { note: WORDS.startFixed } : {}),
      fields: (
        // A season's two days are one value, sharing their row at every width.
        <FieldPair
          short="both"
          phone="pair">
          <DateField
            label={WORDS.beginn}
            name="start"
            isRequired={required.start}
            isDisabled={facts.takenPlace}
            value={draft.start}
            onChange={(day) => set("start", day)}
          />
          <DateField
            label={WORDS.ende}
            name="end"
            isRequired={required.end}
            value={draft.end}
            onChange={(day) => set("end", day)}
          />
        </FieldPair>
      ),
    },
    {
      id: "regeln",
      title: WORDS.regeln,
      // The start fixes the scoring and the seeding; a standing draw fixes the counts it was drawn from.
      ...(facts.begun ? { note: WORDS.lockedSinceStart } : drawn ? { note: WORDS.lockedByDraw } : {}),
      fields: (
        <>
          <FieldPair
            short="both"
            phone="pair">
            <TextField
              label={WORDS.winPoints}
              name="winPoints"
              width="C2"
              kind="digits"
              isRequired={required.winPoints}
              isDisabled={facts.begun}
              value={draft.winPoints}
              onChange={(value) => set("winPoints", value)}
            />
            <TextField
              label={WORDS.drawPoints}
              name="drawPoints"
              width="C2"
              kind="digits"
              isRequired={required.drawPoints}
              isDisabled={facts.begun}
              value={draft.drawPoints}
              onChange={(value) => set("drawPoints", value)}
            />
          </FieldPair>
          <Select
            label={WORDS.tiebreak}
            name="tiebreak"
            width="fit"
            options={TIEBREAK}
            isRequired={required.tiebreak}
            isDisabled={facts.begun}
            value={draft.tiebreak}
            onChange={(id) => {
              if (id !== null) set("tiebreak", id);
            }}
          />
          <FieldPair
            short="both"
            phone="pair">
            <TextField
              label={WORDS.gruppen}
              name="gruppen"
              width="C2"
              kind="digits"
              isRequired={required.gruppen}
              isDisabled={drawn}
              value={draft.gruppen}
              onChange={(value) => set("gruppen", value)}
            />
            <TextField
              label={WORDS.teamsPerGruppe}
              name="teamsPerGruppe"
              width="C2"
              kind="digits"
              isRequired={required.teamsPerGruppe}
              isDisabled={drawn}
              value={draft.teamsPerGruppe}
              onChange={(value) => set("teamsPerGruppe", value)}
            />
          </FieldPair>
          <Select
            label={WORDS.qualifiers}
            name="qualifiers"
            width="fit"
            options={qualifiers}
            isRequired={required.qualifiers}
            isDisabled={facts.begun || drawn}
            value={draft.qualifiers}
            onChange={(id) => {
              if (id !== null) set("qualifiers", id);
            }}
          />
          <TextField
            label={WORDS.maxKader}
            name="maxKader"
            width="C2"
            kind="digits"
            isRequired={required.maxKader}
            value={draft.maxKader}
            onChange={(value) => set("maxKader", value)}
          />
          <ToggleBoxes
            label={WORDS.stufen}
            choices={STUFEN}
            value={draft.stufen}
            onChange={(ids) => set("stufen", ids)}
          />
        </>
      ),
    },
    {
      id: "forfeit",
      title: WORDS.forfeit,
      fields: (
        <FieldPair
          short="both"
          phone="pair">
          <TextField
            label={WORDS.forfeitWinner}
            name="forfeitWinner"
            width="C2"
            kind="digits"
            isRequired={required.forfeitWinner}
            value={draft.forfeitWinner}
            onChange={(value) => set("forfeitWinner", value)}
          />
          <TextField
            label={WORDS.forfeitLoser}
            name="forfeitLoser"
            width="C2"
            kind="digits"
            isRequired={required.forfeitLoser}
            value={draft.forfeitLoser}
            onChange={(value) => set("forfeitLoser", value)}
          />
        </FieldPair>
      ),
    },
    {
      id: "bewerbungsfenster",
      title: WORDS.bewerbungsfenster,
      fields: (
        <FieldPair
          short="both"
          phone="pair">
          <DateField
            label={WORDS.beginn}
            name="bewerbungStart"
            value={draft.bewerbungStart}
            onChange={(day) => set("bewerbungStart", day)}
          />
          <DateField
            label={WORDS.ende}
            name="bewerbungEnd"
            value={draft.bewerbungEnd}
            onChange={(day) => set("bewerbungEnd", day)}
          />
        </FieldPair>
      ),
    },
    {
      id: "registrierungsfenster",
      title: WORDS.registrierungsfenster,
      fields: (
        <>
          <DateField
            label={WORDS.ende}
            name="registrierungEnd"
            value={draft.registrierungEnd}
            onChange={(day) => set("registrierungEnd", day)}
          />
          <Checkbox
            label={WORDS.registrierungPaused}
            name="registrierungPaused"
            isSelected={draft.registrierungPaused}
            onChange={(paused) => set("registrierungPaused", paused)}
          />
        </>
      ),
    },
    {
      id: "spielplan",
      title: SPIELPLAN,
      fields:
        facts.spielplan === null ? (
          <SectionAct
            label={COPY.shared.withObject(SPIELPLAN, "create")}
            variant="primary"
            isDisabled={isClosed}
            run={() => acts.draw({ saison_id: saison })}
          />
        ) : (
          <Facts
            facts={[
              { label: COPY.spielplan.spieltage, value: { record: formatNumber(facts.spielplan.spieltage) }, figures: true },
              { label: COPY.page.spiele, value: { record: formatNumber(facts.spielplan.spiele) }, figures: true },
              { label: WORDS.drawnOn, value: { record: formatDatum(facts.spielplan.drawnOn) }, figures: true },
            ]}
          />
        ),
    },
    {
      id: "gruppentausch",
      title: WORDS.gruppentausch,
      ...(facts.begun ? { note: WORDS.lockedSinceStart } : {}),
      fields: (
        <Swap
          saison={saison}
          clubs={clubs}
          swap={acts.swap}
          locked={facts.begun || isClosed}
        />
      ),
    },
    {
      id: "ersatz",
      title: WORDS.ersatz,
      ...(facts.begun ? { note: WORDS.lockedSinceStart } : {}),
      fields: (
        <Replacement
          saison={saison}
          clubs={clubs}
          incoming={incoming}
          replace={acts.replace}
          locked={facts.begun || isClosed}
        />
      ),
    },
  ];

  const danger: DangerAct[] = [
    ...(drawn
      ? [
          {
            name: COPY.shared.withObject(SPIELPLAN, "recreate"),
            consequence: WORDS.recreateConsequence,
            touch,
            confirm: {
              verb: "recreate",
              subject: SPIELPLAN,
              consequence: WORDS.recreateConsequence,
              tone: "danger",
              onConfirm: () => acts.recreate(of),
            },
          } satisfies DangerAct,
          {
            name: COPY.shared.withObject(SPIELPLAN, "delete"),
            consequence: WORDS.deleteConsequence,
            touch,
            confirm: {
              verb: "delete",
              subject: SPIELPLAN,
              consequence: WORDS.deleteConsequence,
              tone: "danger",
              onConfirm: () => acts.undraw(of),
            },
          } satisfies DangerAct,
        ]
      : []),
    // The site's own season has no switch onto it.
    ...(facts.isCurrent
      ? []
      : [
          {
            name: WORDS.umstellung,
            consequence: WORDS.activateConsequence(saison),
            touch,
            ...(drawn ? {} : { blocked: WORDS.noDraw }),
            confirm: {
              verb: "activate",
              subject: WORDS.onto(saison),
              consequence: WORDS.activateConsequence(saison),
              tone: "primary",
              onConfirm: () => acts.activate(of),
            },
          } satisfies DangerAct,
        ]),
  ];

  return (
    <EditorPage
      title={title}
      chip={chip}
      // Which season the site shows is a fact of the season, never a state word.
      {...(facts.isCurrent ? { lead: WORDS.isCurrent } : {})}
      editor={editor}
      closed={closed}
      sections={sections}
      danger={danger}
    />
  );
}
