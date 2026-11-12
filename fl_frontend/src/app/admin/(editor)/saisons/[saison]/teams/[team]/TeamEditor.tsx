"use client";

import { useState } from "react";

import { AddressFields } from "@/kit/AddressFields";
import { Segmented } from "@/kit/ChoiceButtons";
import { DateField } from "@/kit/DateField";
import { EditorPage } from "@/kit/EditorPage";
import { Facts } from "@/kit/Facts";
import { SeatRows } from "@/kit/SeatRows";
import { Select } from "@/kit/Select";
import { TextField } from "@/kit/TextField";
import { useEditor } from "@/kit/useEditor";

import { COPY } from "@/core/copy";
import { FLAustrittType } from "@/core/generated/client/types";
import { SHORTHAND_LENGTH } from "@/features/bewerbungen/constants";
import { seatActKinds } from "@/features/teams/components/forms/seatActKinds";
import { SeatActs } from "@/features/teams/components/forms/SeatActs";
import { schulformOptions } from "@/features/teams/options";

import { FormInvitationSection } from "./FormInvitationSection";
import { reactivateTeam, recordAustritt, retireTeam, sendSeatLink, writeSeat } from "./teamActs";

import type { ActionAnswer } from "@/core/action";
import type { Copy, LockReason } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { AustrittRules, SeatRules, TeamRules } from "@/features/teams/fieldRules";
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

const WORDS = COPY.admin.team;
const TEAM = COPY.shared.facts.team;

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
  /** Why a seat's link goes nowhere: the club left. */
  sendLocked?: Copy;
  /** The exit's act, which a club already out of the season no longer offers. */
  exit: { earliest: CalendarDay; today: CalendarDay; locked?: Copy } | null;
};

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
  descriptionMax,
  seatRules,
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
  rules: TeamRules;
  descriptionMax: number;
  seatRules: SeatRules;
  austrittRules: AustrittRules;
  /** The danger box's league-wide act: the retiring, closed where a season holds the club, or the return. */
  retirement: { kind: "retire"; locked?: Copy } | { kind: "reactivate" };
  /** `null` for a retired club holding no row of the season. */
  row: TeamRow | null;
}) {
  const editor = useEditor(record, (change) => save({ ...change, saison_id: saison }));
  const { draft, set } = editor;
  const { required, max, address } = rules;
  const [route, setRoute] = useState<string>(FLAustrittType.rueckzug);
  const renamed = draft.name !== record.values.name || draft.shorthand !== record.values.shorthand;
  const isClosed = closed !== undefined;

  const club: EditorSection = {
    id: "team",
    title: TEAM,
    fields: (
      <>
        <TextField
          label={COPY.shared.name}
          name="name"
          kind="text"
          isRequired={required.name}
          maxLength={max.name}
          {...(renamed ? { consequence: WORDS.renameReach } : {})}
          value={draft.name}
          onChange={(name) => set("name", name)}
        />
        <TextField
          label={COPY.team.shorthand}
          name="shorthand"
          holds={5}
          kind="text"
          isRequired={required.shorthand}
          maxLength={SHORTHAND_LENGTH}
          minLength={SHORTHAND_LENGTH}
          value={draft.shorthand}
          onChange={(shorthand) => set("shorthand", shorthand)}
        />
        <TextField
          label={COPY.team.fullName}
          name="full_name"
          kind="text"
          isRequired={required.full_name}
          maxLength={max.full_name}
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
          example={COPY.shared.field.exampleUrl}
          maxLength={max.website_url}
          value={draft.website_url}
          onChange={(website) => set("website_url", website)}
        />
        <TextField
          label={WORDS.description}
          name="description"
          kind="paragraph"
          description={WORDS.descriptionNote}
          maxLength={descriptionMax}
          value={draft.description}
          onChange={(description) => set("description", description)}
        />
      </>
    ),
  };

  const adresse: EditorSection = {
    id: "adresse",
    title: COPY.admin.spielort.address,
    fields: (
      <AddressFields
        rules={address}
        draft={{ values: draft, set }}
      />
    ),
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
                  isRequired={rules.gruppeRequired}
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
                  const link = target.asks
                    ? {
                        send: sendSeatLink,
                        seat: { team_id: team, saison_id: saison, seat: target.rolle },
                        ...(row.sendLocked === undefined ? {} : { locked: row.sendLocked }),
                      }
                    : null;
                  return {
                    ...seat,
                    sideActs: seatActKinds(link).length,
                    acts: (
                      <SeatActs
                        rollen={target.rollen}
                        person={target.person}
                        rules={seatRules}
                        write={writeSeat}
                        carry={{ team_id: team, saison_id: saison, seat: target.rolle, version: String(row.version) }}
                        link={link}>
                        {target.rolle === "trainer" && (
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
            fields: isClosed ? (
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
            act: { verb: "remove" },
            tone: "danger",
            action: recordAustritt,
            carry: { team_id: team, saison_id: saison, type: route },
            children: (
              <>
                <Segmented
                  label={WORDS.austrittType}
                  isRequired={austrittRules.required.type}
                  choices={[
                    { id: FLAustrittType.rueckzug, label: COPY.shared.austritt.rueckzug.label },
                    { id: FLAustrittType.disqualifikation, label: COPY.shared.austritt.disqualifikation.label },
                  ]}
                  value={route}
                  onChange={setRoute}
                />
                <TextField
                  label={COPY.admin.spiel.reason}
                  name="reason"
                  kind="paragraph"
                  isRequired={austrittRules.required.reason}
                  maxLength={austrittRules.reasonMax}
                  description={WORDS.austrittReasonDescription}
                />
                <DateField
                  label={WORDS.austrittFrom}
                  name="date"
                  isRequired={austrittRules.required.date}
                  defaultValue={exit.today}
                  minValue={exit.earliest}
                  consequence={WORDS.austrittLine}
                />
                <Facts facts={[{ label: COPY.admin.facts.mailTo, value: WORDS.austrittMailTo }]} />
              </>
            ),
          },
        };

  const retirementAct: DangerAct =
    retirement.kind === "reactivate"
      ? {
          name: COPY.shared.withObject(TEAM, "reactivate"),
          consequence: WORDS.reactivateConsequence,
          confirm: {
            verb: "reactivate",
            subject: TEAM,
            consequence: WORDS.reactivateConsequence,
            tone: "primary",
            onConfirm: () => reactivateTeam({ id: team }),
          },
        }
      : {
          name: COPY.shared.withObject(TEAM, "retire"),
          consequence: WORDS.retireConsequence,
          ...(retirement.locked === undefined ? {} : { locked: retirement.locked }),
          confirm: {
            verb: "retire",
            subject: TEAM,
            consequence: WORDS.retireConsequence,
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
      {...(closed === undefined ? {} : { closed })}
      locks={locks}
      sections={[club, adresse, ...seasonBoxes]}
      danger={{
        title: WORDS.dangerBox(exitAct !== null, true),
        acts: exitAct === null ? [retirementAct] : [exitAct, retirementAct],
        outlivesClosed: true,
      }}
    />
  );
}
