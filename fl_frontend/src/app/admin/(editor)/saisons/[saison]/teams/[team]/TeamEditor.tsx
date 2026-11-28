"use client";

import { useState } from "react";

import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { FLAustrittType } from "@/core/generated/client/types";
import { schulformOptions } from "@/features/teams/options";
import { SeatActs } from "@/features/teams/SeatActs";
import { AddressFields } from "@/kit/AddressFields";
import { Segmented } from "@/kit/ChoiceButtons";
import { DateField } from "@/kit/DateField";
import { EditorPage } from "@/kit/EditorPage";
import { Facts } from "@/kit/Facts";
import { SeatRows } from "@/kit/SeatRows";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";
import { useEditor } from "@/kit/useEditor";

import { exitFactsOf } from "./exitFacts";
import { FormInvitationSection } from "./FormInvitationSection";
import { reactivateTeam, recordAustritt, retireTeam, sendSeatLink, writeSeat } from "./teamActs";

import type { ActionAnswer } from "@/core/action";
import type { BoxRules } from "@/core/boxRules";
import type { Copy, LockReason } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { FLAustrittRecipients } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { DangerAct, EditorSection } from "@/kit/EditorPage";
import type { Fact } from "@/kit/Facts";
import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { SeatRow } from "@/kit/SeatRows";
import type { EditorRecord, EditorSave } from "@/kit/useEditor";
import type { InvitationView } from "./FormInvitationSection";
import type { SeatTarget } from "./seats";
import type { TeamValues } from "./teamValues";

const WORDS = ADMIN_COPY.team;
const TEAM = COPY.shared.facts.team;
const RETIRE_CONSEQUENCE = ADMIN_COPY.retireConsequence(WORDS.withArticle, COPY.page.adminSaisons);
const REACTIVATE_CONSEQUENCE = ADMIN_COPY.reactivateConsequence(WORDS.withArticle);

/** The boxes of the club's row of the season, which a retired club holding none leaves out. */
export type TeamRow = {
  saisonTitle: Copy;
  gruppen: readonly Option[];
  /** Why the group is fixed, where it is: the club left, or a draw stands. */
  gruppeLocked: LockReason | null;
  /** The colours open to the club: every one but those another row of the season holds. */
  colours: readonly Option[];
  /** Why the colour is fixed, where it is: the club left. */
  colourLocked: LockReason | null;
  /** The exit's facts, once the club left. */
  austritt: readonly Fact[] | null;
  /** The row's own count, which a seat's write sends. */
  version: number;
  seats: ReadonlyArray<Omit<SeatRow, "acts"> & { target: SeatTarget }>;
  invitation: InvitationView;
  /** The club left the season, which no write undoes: its link acts are left out, as a closed page's are. */
  departed?: true;
  /** The exit's act, which a club already out of the season no longer offers, with whom an exit would mail by day. */
  exit: { earliest: CalendarDay; today: CalendarDay; locked?: Copy; recipients: readonly FLAustrittRecipients[] } | null;
};

/** The exit's day, and under it whom an exit from the day typed mails: held here, so each opening starts on today. */
function ExitDay({ exit }: { exit: NonNullable<TeamRow["exit"]> }) {
  const [day, setDay] = useState<CalendarDay | null>(exit.today);
  return (
    <>
      <DateField
        label={WORDS.austrittFrom}
        name="date"
        value={day}
        onChange={setDay}
        minValue={exit.earliest}
        consequence={WORDS.austrittLine}
      />
      <Facts facts={exitFactsOf(exit.recipients, day)} />
    </>
  );
}

/**
 * The team editor, the record of one club in one season: the club, its address and its row of the season, saved together
 * from the bar on one version; its three seats, each written by its own dialog; its registration link, each act of its
 * own; and the danger box taking it out of the season or out of the league.
 */
export function TeamEditor({
  team,
  saison,
  title,
  chip,
  closed,
  record,
  save,
  rules,
  seatRules,
  holder,
  austrittRules,
  retirement,
  row,
}: {
  team: string;
  saison: string;
  title: PageTitle;
  chip?: ChipProps;
  /** The reason the page opens read-only. */
  closed?: Copy;
  record: EditorRecord<TeamValues>;
  save: (change: EditorSave<TeamValues> & { saison_id: string }) => Promise<ActionAnswer<number>>;
  /** What the save's lane asks of its boxes, read on the server, and the seat's write's and the exit's. */
  rules: BoxRules;
  seatRules: BoxRules;
  /** The address the page was drawn for, which a seat's write behind the passkey touch posts. */
  holder: string;
  austrittRules: BoxRules;
  /** The danger box's league-wide act: the retiring, closed where a season holds the club, or the return. */
  retirement: { kind: "retire"; locked?: Copy } | { kind: "reactivate" };
  /** `null` for a retired club holding no row of the season. */
  row: TeamRow | null;
}) {
  const editor = useEditor(record, (change) => save({ ...change, saison_id: saison }));
  const { draft, set } = editor;
  const [route, setRoute] = useState<string>(FLAustrittType.rueckzug);
  const renamed = draft.name !== record.values.name || draft.shorthand !== record.values.shorthand;
  const isClosed = closed !== undefined;
  const departed = row?.departed === true;

  const teamBox: EditorSection = {
    id: "team",
    title: TEAM,
    fields: (
      <>
        <TextField
          label={COPY.shared.name}
          name="name"
          kind="text"
          {...(renamed ? { consequence: WORDS.renameReach } : {})}
          value={draft.name}
          onChange={(name) => set("name", name)}
        />
        <TextField
          label={COPY.team.shorthand}
          name="shorthand"
          holds={5}
          kind="text"
          value={draft.shorthand}
          onChange={(shorthand) => set("shorthand", shorthand)}
        />
        <TextField
          label={COPY.team.fullName}
          name="full_name"
          kind="text"
          value={draft.full_name}
          onChange={(fullName) => set("full_name", fullName)}
        />
        <Select
          label={COPY.team.schulform}
          name="schulform"
          options={schulformOptions()}
          value={draft.schulform}
          onChange={(schulform) => set("schulform", schulform ?? "")}
        />
        <TextField
          label={COPY.team.website}
          name="website_url"
          kind="url"
          value={draft.website_url}
          onChange={(website) => set("website_url", website)}
        />
        <TextField
          label={WORDS.description}
          name="description"
          kind="paragraph"
          description={WORDS.descriptionNote}
          value={draft.description}
          onChange={(description) => set("description", description)}
        />
      </>
    ),
  };

  const adresse: EditorSection = {
    id: "adresse",
    title: COPY.shared.address.title,
    fields: <AddressFields draft={{ values: draft, set }} />,
  };

  const seasonBoxes: EditorSection[] =
    row === null
      ? []
      : [
          {
            id: "saison",
            title: row.saisonTitle,
            fields: (
              <>
                <Select
                  label={COPY.team.gruppe}
                  name="gruppe"
                  isLocked={row.gruppeLocked !== null}
                  options={row.gruppen}
                  value={draft.gruppe}
                  onChange={(gruppe) => set("gruppe", gruppe ?? record.values.gruppe)}
                />
                <Select
                  label={COPY.team.trikotFarbe}
                  name="trikot_farbe"
                  isLocked={row.colourLocked !== null}
                  options={row.colours}
                  value={draft.trikot_farbe}
                  onChange={(colour) => set("trikot_farbe", colour ?? "")}
                />
                {row.austritt !== null && <Facts facts={row.austritt} />}
              </>
            ),
          },
          {
            id: "kontakte",
            title: COPY.team.kontakte,
            fields: (
              <SeatRows
                label={COPY.team.kontakte}
                rows={row.seats.map(({ target, ...seat }) => {
                  // A finished season's seats are its record, and a closed page acts on nothing but its danger box.
                  if (isClosed) return seat;
                  // A club that left takes no link again, since an exit is never lifted, so its seats offer none.
                  const link =
                    target.asks && !departed ? { send: sendSeatLink, seat: { team_id: team, saison_id: saison, seat: target.seat } } : null;
                  return {
                    ...seat,
                    acts: (
                      <SeatActs
                        seats={target.seats}
                        person={target.person}
                        rules={seatRules}
                        write={writeSeat}
                        carry={{ team_id: team, saison_id: saison, seat: target.seat, version: String(row.version) }}
                        holder={holder}
                        link={link}>
                        {target.seat === "trainer" && (
                          <Select
                            label={COPY.team.trainerAlso.label}
                            name="trainer_is_also"
                            description={COPY.team.trainerAlso.description}
                            options={[
                              { id: "", label: COPY.team.trainerAlso.none },
                              { id: "ansprechperson", label: COPY.team.seatName.ansprechperson },
                              { id: "stellvertretung", label: COPY.team.seatName.stellvertretung },
                            ]}
                            defaultValue={target.trainerAlso ?? ""}
                          />
                        )}
                      </SeatActs>
                    ),
                  };
                })}
              />
            ),
          },
          {
            id: "registrierungLink",
            title: WORDS.registrierungLink,
            // A closed page's link and a departed club's stand as facts: neither takes an act again.
            fields:
              isClosed || departed ? (
                <Facts facts={row.invitation.facts} />
              ) : (
                <FormInvitationSection
                  team={team}
                  saison={saison}
                  view={row.invitation}
                />
              ),
          },
        ];

  const exit = row?.exit ?? null;
  const exitAct: DangerAct | null =
    exit === null || isClosed
      ? null
      : {
          name: WORDS.austrittAct,
          consequence: WORDS.austrittRowLine,
          ...(exit.locked === undefined ? {} : { locked: exit.locked }),
          dialog: {
            title: WORDS.austrittAct,
            act: { verb: "enter" },
            tone: "danger",
            run: recordAustritt,
            rules: austrittRules,
            carry: { team_id: team, saison_id: saison },
            children: (
              <>
                <Segmented
                  label={WORDS.austrittType}
                  name="type"
                  choices={[
                    { id: FLAustrittType.rueckzug, label: COPY.shared.austritt.rueckzug.label },
                    { id: FLAustrittType.disqualifikation, label: COPY.shared.austritt.disqualifikation.label },
                  ]}
                  value={route}
                  onChange={setRoute}
                />
                <TextField
                  label={COPY.shared.reason}
                  name="reason"
                  kind="paragraph"
                  description={WORDS.austrittReasonDescription}
                />
                <ExitDay exit={exit} />
              </>
            ),
          },
        };

  const retirementAct: DangerAct =
    retirement.kind === "reactivate"
      ? {
          name: COPY.shared.withObject(TEAM, "reactivate"),
          consequence: REACTIVATE_CONSEQUENCE,
          confirm: {
            verb: "reactivate",
            subject: TEAM,
            consequence: REACTIVATE_CONSEQUENCE,
            tone: "primary",
            onConfirm: () => reactivateTeam({ id: team }),
          },
        }
      : {
          name: COPY.shared.withObject(TEAM, "retire"),
          consequence: RETIRE_CONSEQUENCE,
          ...(retirement.locked === undefined ? {} : { locked: retirement.locked }),
          confirm: {
            verb: "retire",
            subject: TEAM,
            consequence: RETIRE_CONSEQUENCE,
            tone: "danger",
            onConfirm: () => retireTeam({ id: team }),
          },
        };

  // The line says each reason once, an exit's once for the group and the colour it fixes alike.
  const locks = row === null ? [] : [row.gruppeLocked, row.colourLocked].filter((reason) => reason !== null);

  return (
    <EditorPage
      title={title}
      chip={chip}
      editor={editor}
      rules={rules}
      {...(closed === undefined ? {} : { closed })}
      locks={locks}
      sections={[teamBox, adresse, ...seasonBoxes]}
      danger={{
        title: WORDS.dangerBox(exitAct !== null, true),
        acts: exitAct === null ? [retirementAct] : [exitAct, retirementAct],
        outlivesClosed: true,
      }}
    />
  );
}
