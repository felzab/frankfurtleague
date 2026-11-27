"use client";

import { useState } from "react";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { dayBefore } from "@/core/dayArithmetic";
import { formatDate, formatNumber } from "@/core/format";
import { FLSpielerStufe } from "@/core/generated/client/types";
import { Checkbox } from "@/kit/Checkbox";
import { ToggleBoxes } from "@/kit/ChoiceButtons";
import { ComboBox } from "@/kit/ComboBox";
import { DateField } from "@/kit/DateField";
import { EditorPage } from "@/kit/EditorPage";
import { Facts } from "@/kit/Facts";
import { FieldRows } from "@/kit/FieldRows";
import { Section } from "@/kit/Section";
import { SectionAct } from "@/kit/SectionAct";
import { Select } from "@/kit/Select";
import { Table } from "@/kit/Table";
import { TextField } from "@/kit/TextField";
import { useEditor } from "@/kit/useEditor";

import { requiredOf } from "./saisonValues";

import type { ActionAnswer } from "@/core/action";
import type { BoxRules } from "@/core/boxRules";
import type { Copy, LockReason } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { FLSpielplanShape } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { DangerAct, EditorPart } from "@/kit/EditorPage";
import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { TableHead, TableRow } from "@/kit/Table";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { SaisonValues } from "./saisonValues";

const WORDS = ADMIN_COPY.saison;
const SPIELPLAN = COPY.page.spielplan;
const TEAM = COPY.shared.facts.team;

const TIEBREAK: readonly Option[] = [
  { id: "tordifferenz", label: WORDS.tordifferenz },
  { id: "direkter_vergleich", label: WORDS.direkterVergleich },
];

const STUFEN = Object.values(FLSpielerStufe).map((stufe) => ({ id: stufe, label: { record: stufe } }));

/** One club of the season as the swap and the replacement list it. */
export type SaisonTeam = { id: string; name: string; gruppe: string };

/** What the season holds beyond its fields: where it stands, its draw, and what the editor's acts read. */
export type SaisonFacts = {
  /** The season's start has passed, which fixes its scoring, its seeding and its clubs. */
  begun: boolean;
  /** A match of it has taken place, which fixes its start. */
  takenPlace: boolean;
  /** The site shows this season. */
  isCurrent: boolean;
  /** The season the site shows, which the switch onto this one leaves; `null` before the league's first. */
  siteShows: string | null;
  /** The Spielplan the season holds, counted off its stored matchdays and fixtures as the draw's writes judge them. */
  spielplan: { spieltage: number; spiele: number; drawnOn: CalendarDay } | null;
  /** Why the draw and each danger act cannot run now, by the refusal its write would answer, which the read serves. */
  locked: { activate?: Copy; create?: Copy; recreate?: Copy; undraw?: Copy };
};

/** The registration links: their table's head and each team's row, and how many teams the press would mail. */
export type SaisonLinks = { head: TableHead; rows: readonly TableRow[]; mailed: number };

/** The acts the editor's sections and its danger rows press, each a server action naming its season. */
export type SaisonActs = {
  draw: (input: { saison_id: string }) => Promise<ActionAnswer>;
  recreate: (input: { saison_id: string; holder: string }) => Promise<ActionAnswer>;
  undraw: (input: { saison_id: string; holder: string }) => Promise<ActionAnswer>;
  activate: (input: { saison_id: string; holder: string }) => Promise<ActionAnswer>;
  swap: (input: { saison_id: string; team1_id: string; team2_id: string }) => Promise<ActionAnswer>;
  replace: (input: { saison_id: string; team_id: string; incoming_team_id: string }) => Promise<ActionAnswer>;
  sendLinks: (input: { saison_id: string }) => Promise<ActionAnswer>;
};

/** An act's closing, where its read names a reason. */
const lockedBy = (reason: Copy | undefined) => (reason === undefined ? {} : { locked: reason });

/** A club as a picker lists it, „Lessing · Gruppe A“. */
const optionOf = (team: SaisonTeam): Option => ({
  id: team.id,
  label: COPY.shared.line([{ record: team.name }, COPY.shared.season.gruppe(team.gruppe)]),
});

/**
 * What the swap and the replacement are handed of the season: whether it has begun, which locks both, their lock line
 * saying so once.
 */
type SeasonState = { begun: boolean };

/** The group swap: two clubs of different groups. */
function Swap({ saison, teams, swap, begun }: { saison: string; teams: readonly SaisonTeam[]; swap: SaisonActs["swap"] } & SeasonState) {
  const [first, setFirst] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);
  const chosen = teams.find((team) => team.id === first);
  // A swap within one group exchanges nothing: the second club is one of another group.
  const partners = chosen === undefined ? teams : teams.filter((team) => team.gruppe !== chosen.gruppe);
  return (
    <SectionAct
      inputs={[first, second]}
      acts={[
        {
          act: { verb: "swap", object: WORDS.gruppen },
          // Locked from the start, which the editor's lock line says; until both clubs are chosen, with the reason.
          locked: begun || (first === null || second === null ? ADMIN_COPY.bothTeamsLocked : undefined),
          run: async () => (first === null || second === null ? { ok: false } : swap({ saison_id: saison, team1_id: first, team2_id: second })),
        },
      ]}>
      <ComboBox
        label={COPY.shared.teamPair.team1}
        options={teams.map(optionOf)}
        plural={COPY.page.teams}
        isLocked={begun}
        value={first}
        onChange={(id) => {
          setFirst(id);
          setSecond(null);
        }}
      />
      <ComboBox
        label={COPY.shared.teamPair.team2}
        options={partners.map(optionOf)}
        plural={COPY.page.teams}
        isLocked={begun}
        value={second}
        onChange={setSecond}
      />
    </SectionAct>
  );
}

/** The replacement: a club leaving the season, and the club taking over. */
function Replacement({
  saison,
  teams,
  incoming,
  replace,
  begun,
}: {
  saison: string;
  teams: readonly SaisonTeam[];
  incoming: readonly { id: string; name: string }[];
  replace: SaisonActs["replace"];
} & SeasonState) {
  const [out, setOut] = useState<string | null>(null);
  const [into, setInto] = useState<string | null>(null);
  const leaving = teams.find((team) => team.id === out);
  const arriving = incoming.find((team) => team.id === into);
  const consequence =
    leaving === undefined || arriving === undefined
      ? undefined
      : WORDS.replaceConsequence({ record: arriving.name }, { record: leaving.name }, leaving.gruppe);
  return (
    <SectionAct
      inputs={[out, into]}
      acts={[
        {
          act: { verb: "replace", object: TEAM },
          locked: begun || (consequence === undefined ? ADMIN_COPY.bothTeamsLocked : undefined),
          // Asked only once both clubs are chosen, the button locked with its reason until then.
          confirm: { verb: "replace", subject: TEAM, consequence: consequence ?? COPY.shared.noValue, tone: "primary" },
          run: async () =>
            out === null || into === null ? { ok: false } : replace({ saison_id: saison, team_id: out, incoming_team_id: into }),
        },
      ]}>
      <ComboBox
        label={WORDS.outgoing}
        options={teams.map(optionOf)}
        plural={COPY.page.teams}
        isLocked={begun}
        value={out}
        onChange={setOut}
      />
      <ComboBox
        label={WORDS.incoming}
        options={incoming.map((team) => ({ id: team.id, label: { record: team.name } }))}
        plural={COPY.page.teams}
        isLocked={begun}
        value={into}
        onChange={setInto}
        consequence={consequence}
      />
    </SectionAct>
  );
}

/**
 * The season editor: its dates, its rules and its two windows, saved together from the editor's bar; then its draw,
 * its group swap, its replacement and its registration links, each an act of its own box, which a finished season's
 * page leaves out, a box holding nothing else going with its act; its irreversible acts, the
 * draw's regeneration and removal and the switch of the site onto it, in the danger rows behind the passkey touch, each
 * closed with its reason where its write would refuse it now.
 */
export function SaisonEditor({
  saison,
  title,
  chip,
  record,
  save,
  rules,
  facts,
  shapes,
  teams,
  incoming,
  links,
  holder,
  acts,
  closed,
}: {
  saison: string;
  title: PageTitle;
  chip: ChipProps;
  record: EditorRecord<SaisonValues>;
  save: (change: EditorSave<SaisonValues>) => Promise<ActionAnswer<number>>;
  /** What the save's lane asks of its boxes, read on the server. */
  rules: BoxRules;
  facts: SaisonFacts;
  /** Every shape the draw admits beside the season's other rules, which the qualifiers are offered from. */
  shapes: readonly FLSpielplanShape[];
  teams: readonly SaisonTeam[];
  incoming: readonly { id: string; name: string }[];
  links: SaisonLinks;
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
    .filter(
      (shape) =>
        String(shape.number_of_gruppen) === draft["rules.number_of_gruppen"] &&
        String(shape.teams_per_gruppe) === draft["rules.teams_per_gruppe"],
    )
    .map((shape) => String(shape.qualifiers_per_gruppe));
  const qualifiers = [...new Set([...offered, draft["rules.qualifiers_per_gruppe"]])]
    .filter((value) => value !== "")
    .toSorted((one, other) => Number(one) - Number(other))
    .map((value): Option => ({ id: value, label: { record: value } }));

  const touch = { holder };
  const of = { saison_id: saison, holder };

  // Each field locks off the write's own refusal: the start fixes the scoring, the qualifiers, the swap and the
  // replacement; a draw the three counts it was drawn from; a stored result the start date, which no match holds before
  // the start, so the start's reason covers it.
  const locks: LockReason[] = [...(facts.begun ? (["sinceStart"] as const) : []), ...(drawn ? (["byDraw"] as const) : [])];

  const sections: [EditorPart, ...EditorPart[]] = [
    {
      id: "period",
      title: WORDS.period,
      fields: (
        <FieldRows>
          <DateField
            label={WORDS.start}
            name="start_date"
            isLocked={facts.takenPlace}
            value={draft.start_date}
            onChange={(day) => set("start_date", day)}
          />
          <DateField
            label={WORDS.end}
            name="end_date"
            value={draft.end_date}
            onChange={(day) => set("end_date", day)}
            // A span ending before it begins is refused here, before the write sees it.
            {...(draft.start_date === null ? {} : { minValue: draft.start_date })}
          />
        </FieldRows>
      ),
    },
    {
      id: "scoring",
      title: WORDS.scoring,
      // The start fixes the points and the tiebreak; a no-show's goals stay open all season.
      fields: (
        <>
          <FieldRows label={WORDS.punkte}>
            <TextField
              label={WORDS.winPoints}
              name="rules.win_points"
              holds={2}
              kind="digits"
              isLocked={facts.begun}
              value={draft["rules.win_points"]}
              onChange={(value) => set("rules.win_points", value)}
            />
            <TextField
              label={WORDS.drawPoints}
              name="rules.draw_points"
              holds={2}
              kind="digits"
              isLocked={facts.begun}
              value={draft["rules.draw_points"]}
              onChange={(value) => set("rules.draw_points", value)}
            />
            <TextField
              label={WORDS.lossPoints}
              name="rules.loss_points"
              holds={2}
              kind="digits"
              isLocked={facts.begun}
              value={draft["rules.loss_points"]}
              onChange={(value) => set("rules.loss_points", value)}
            />
          </FieldRows>
          <Select
            label={WORDS.tiebreak}
            name="rules.tiebreak_order"
            options={TIEBREAK}
            isLocked={facts.begun}
            value={draft["rules.tiebreak_order"]}
            onChange={(id) => {
              if (id !== null) set("rules.tiebreak_order", id);
            }}
          />
          {/* The goals a no-show is scored with, named as one value: their own labels say no more than a score's. */}
          <FieldRows label={WORDS.forfeit}>
            <TextField
              label={WORDS.forfeitWinner}
              name="rules.forfeit_ergebnis.sieger_tore"
              holds={2}
              kind="digits"
              value={draft["rules.forfeit_ergebnis.sieger_tore"]}
              onChange={(value) => set("rules.forfeit_ergebnis.sieger_tore", value)}
            />
            <TextField
              label={WORDS.forfeitLoser}
              name="rules.forfeit_ergebnis.verlierer_tore"
              holds={2}
              kind="digits"
              value={draft["rules.forfeit_ergebnis.verlierer_tore"]}
              onChange={(value) => set("rules.forfeit_ergebnis.verlierer_tore", value)}
            />
          </FieldRows>
        </>
      ),
    },
    {
      id: "gruppen",
      title: WORDS.gruppenAndKoRunde,
      fields: (
        <FieldRows>
          <TextField
            label={WORDS.gruppen}
            name="rules.number_of_gruppen"
            holds={2}
            kind="digits"
            isLocked={drawn}
            value={draft["rules.number_of_gruppen"]}
            onChange={(value) => set("rules.number_of_gruppen", value)}
          />
          <TextField
            label={WORDS.teamsPerGruppe}
            name="rules.teams_per_gruppe"
            holds={2}
            kind="digits"
            isLocked={drawn}
            value={draft["rules.teams_per_gruppe"]}
            onChange={(value) => set("rules.teams_per_gruppe", value)}
          />
          {/* A count like the two above, offered as a choice because only the counts the draw admits are valid. */}
          <Select
            label={WORDS.qualifiers}
            name="rules.qualifiers_per_gruppe"
            holds={2}
            options={qualifiers}
            isLocked={facts.begun || drawn}
            value={draft["rules.qualifiers_per_gruppe"]}
            onChange={(id) => {
              if (id !== null) set("rules.qualifiers_per_gruppe", id);
            }}
          />
        </FieldRows>
      ),
    },
    {
      id: "kader",
      title: COPY.shared.kader,
      fields: (
        <>
          <TextField
            label={WORDS.maxKader}
            name="rules.max_kader_size"
            holds={2}
            kind="digits"
            value={draft["rules.max_kader_size"]}
            onChange={(value) => set("rules.max_kader_size", value)}
          />
          <ToggleBoxes
            label={WORDS.stufen}
            name="rules.allowed_stufen"
            choices={STUFEN}
            value={draft["rules.allowed_stufen"]}
            onChange={(ids) => set("rules.allowed_stufen", ids)}
          />
        </>
      ),
    },
    {
      id: "bewerbungsfenster",
      title: WORDS.bewerbungsfenster,
      fields: (
        <>
          <FieldRows>
            <DateField
              label={WORDS.start}
              name="bewerbung.start"
              value={draft["bewerbung.start"]}
              onChange={(day) => set("bewerbung.start", day)}
            />
            <DateField
              label={WORDS.end}
              name="bewerbung.end"
              value={draft["bewerbung.end"]}
              onChange={(day) => set("bewerbung.end", day)}
              // A span ending before it begins is refused here, before the write sees it.
              {...(draft["bewerbung.start"] === null ? {} : { minValue: draft["bewerbung.start"] })}
            />
          </FieldRows>
          <Checkbox
            label={WORDS.bewerbungPaused}
            name="bewerbungPaused"
            isSelected={draft.bewerbungPaused}
            onChange={(paused) => set("bewerbungPaused", paused)}
          />
        </>
      ),
    },
    {
      id: "registrierungsfenster",
      title: WORDS.registrierungsfenster,
      fields: (
        <>
          <DateField
            label={WORDS.end}
            name="registrierung.end"
            value={draft["registrierung.end"]}
            onChange={(day) => set("registrierung.end", day)}
            {...(draft.start_date === null ? {} : { maxValue: dayBefore(draft.start_date) })}
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
    // A finished season never drawn holds nothing its box could show, its one act left out.
    ...(facts.spielplan === null && isClosed
      ? []
      : [
          {
            id: "spielplan",
            title: SPIELPLAN,
            fields:
              facts.spielplan === null ? (
                <SectionAct
                  acts={[
                    {
                      act: { verb: "create", object: SPIELPLAN },
                      locked: facts.locked.create,
                      run: () => acts.draw({ saison_id: saison }),
                    },
                  ]}
                />
              ) : (
                <Facts
                  facts={[
                    { label: COPY.spielplan.spieltage, value: { record: formatNumber(facts.spielplan.spieltage) }, figures: true },
                    { label: COPY.page.spiele, value: { record: formatNumber(facts.spielplan.spiele) }, figures: true },
                    {
                      label: WORDS.drawnOn,
                      value: { record: formatDate(facts.spielplan.drawnOn) },
                      figures: true,
                    },
                  ]}
                />
              ),
          },
        ]),
    // A finished season's swap and replacement are acts it cannot run, and their pickers hold no record, so both boxes go.
    ...(isClosed
      ? []
      : [
          {
            id: "gruppentausch",
            title: WORDS.gruppentausch,
            fields: (
              <Swap
                saison={saison}
                teams={teams}
                swap={acts.swap}
                begun={facts.begun}
              />
            ),
          },
          {
            id: "replacement",
            title: WORDS.replacement,
            fields: (
              <Replacement
                saison={saison}
                teams={teams}
                incoming={incoming}
                replace={acts.replace}
                begun={facts.begun}
              />
            ),
          },
        ]),
    {
      id: "invitations",
      // Its own section, the table edge to edge in its box, so the table's width is the box's, which picks its form.
      block: (
        <Section
          title={WORDS.invitations}
          list={
            <Table
              {...links.head}
              label={WORDS.invitations}
              rows={links.rows}
              empty={{ kind: "none", plural: COPY.page.teams, glyph: "teams" }}
              bare
            />
          }>
          {/* Left out on a finished season's page, the table standing alone as the box's facts. */}
          {isClosed ? undefined : (
            <SectionAct
              acts={[
                {
                  act: { verb: "send", object: WORDS.invitations },
                  // The press's own plan reaches nobody: every team is passed over or already mailed.
                  ...lockedBy(links.mailed === 0 ? WORDS.dispatchLocked : undefined),
                  confirm: {
                    verb: "send",
                    subject: WORDS.invitations,
                    consequence: WORDS.dispatchConsequence(links.mailed),
                    tone: "primary",
                  },
                  run: () => acts.sendLinks({ saison_id: saison }),
                },
              ]}
            />
          )}
        </Section>
      ),
    },
  ];

  // What the draw's regeneration and its removal delete, which each question counts under its sentence.
  const drawCounts =
    facts.spielplan === null
      ? []
      : [
          { label: COPY.spielplan.spieltage, value: { record: formatNumber(facts.spielplan.spieltage) }, figures: true },
          { label: COPY.page.spiele, value: { record: formatNumber(facts.spielplan.spiele) }, figures: true },
        ];

  const danger: DangerAct[] = [
    ...(drawn
      ? [
          {
            name: COPY.shared.withObject(SPIELPLAN, "recreate"),
            consequence: WORDS.recreateConsequence,
            ...lockedBy(facts.locked.recreate),
            confirm: {
              verb: "recreate",
              subject: SPIELPLAN,
              consequence: WORDS.recreateConsequence,
              facts: drawCounts,
              tone: "danger",
              onConfirm: () => acts.recreate(of),
              touch,
            },
          } satisfies DangerAct,
          {
            name: COPY.shared.withObject(SPIELPLAN, "delete"),
            consequence: WORDS.deleteConsequence,
            ...lockedBy(facts.locked.undraw),
            confirm: {
              verb: "delete",
              subject: SPIELPLAN,
              consequence: WORDS.deleteConsequence,
              facts: drawCounts,
              tone: "danger",
              onConfirm: () => acts.undraw(of),
              touch,
            },
          } satisfies DangerAct,
        ]
      : []),
    // The site's own season has no switch onto it.
    ...(facts.isCurrent
      ? []
      : [
          {
            // The act and its season, as the draw's rows name theirs, so the row never repeats the box's title.
            name: COPY.shared.withObject(WORDS.onto(saison), "activate"),
            consequence: WORDS.activateConsequence(saison),
            ...lockedBy(facts.locked.activate),
            confirm: {
              verb: "activate",
              subject: WORDS.onto(saison),
              consequence: WORDS.activateQuestion,
              facts: [
                {
                  label: COPY.shared.facts.before,
                  value: facts.siteShows === null ? COPY.shared.noValue : COPY.shared.saisonName(facts.siteShows),
                },
                { label: ADMIN_COPY.facts.fromNow, value: COPY.shared.saisonName(saison) },
              ],
              tone: "primary",
              onConfirm: () => acts.activate(of),
              touch,
            },
          } satisfies DangerAct,
        ]),
  ];

  return (
    <EditorPage
      title={title}
      chip={chip}
      editor={editor}
      rules={rules}
      // The application window is none or both of its days, so a day is asked for once the other holds one.
      requiredOf={requiredOf}
      closed={closed}
      locks={locks}
      sections={sections}
      // Titled by what its rows are about: the draw's two acts, the switch onto the season, or both.
      danger={{ title: WORDS.dangerBox(drawn, !facts.isCurrent), acts: danger }}
    />
  );
}
