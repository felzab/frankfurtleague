import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";
import { FactsPlaceholder } from "@/kit/Facts";
import { FieldPlaceholder } from "@/kit/FieldPair";
import { SeatRowsPlaceholder } from "@/kit/SeatRows";

import { now } from "@/core/clock";
import { COPY } from "@/core/copy";
import { dayIn, dayOf, formatDate } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { adminTeamChip } from "@/features/teams/constants";
import { AUSTRITT_RULES, SEAT_RULES, TEAM_DESCRIPTION_MAX, TEAM_SAVE_RULES } from "@/features/teams/fieldRules";
import { gruppeOptions, trikotOptions } from "@/features/teams/options";
import { getTeamSaisonAdmin } from "@/features/teams/queries";
import { adminIdParamOf } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { saveTeam } from "./saveTeam";
import { seatsOf } from "./seats";
import { TeamEditor } from "./TeamEditor";
import { valuesOf } from "./teamValues";

import type { Copy } from "@/core/copy";
import type { FLTeamLinkState, FLTeamMembership, FLTeamSaisonAdminResponse } from "@/core/generated/client/types";
import type { Metadata, ResolvingMetadata } from "next";
import type { TeamRow } from "./TeamEditor";

type Props = PageProps<"/admin/saisons/[saison]/teams/[team]">;

const WORDS = COPY.admin.team;
const LINK_WORDS = COPY.admin.saison;

/** One of the editor's selects of a few short choices while it is read. */
const SELECT = (
  <FieldPlaceholder
    key="select"
    width="standard"
  />
);

/** The club the address names in its season, retired or not: `null` for a malformed id and for one no record holds. */
async function find(params: Props["params"]) {
  const [{ saison }, id] = await Promise.all([params, adminIdParamOf(params, "team")]);
  return id === null ? null : getTeamSaisonAdmin(id, saison);
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(find(params), ({ team, saison }) =>
    pageMetadata(parent, ROUTES.adminTeam, ROUTES.adminTeam.path(saison.id, team.id), { title: { record: team.full_name } }),
  );
}

/** The team editor, on the club's one view read in the season its address names. */
export default function TeamEditorPage({ params }: Props) {
  return (
    <EditorShell
      wait={{
        sections: [
          [
            "field",
            <FieldPlaceholder
              key="shorthand"
              width="short"
              holds={5}
            />,
            "field",
            SELECT,
            "field",
            <FieldPlaceholder
              key="description"
              width="full"
            />,
          ],
          ["pair", "pair", "field"],
          // A club that left: the box says since when, over the exit's three facts.
          {
            note: LINK_WORDS.lockedSinceStart,
            rows: [
              SELECT,
              SELECT,
              <FactsPlaceholder
                key="austritt"
                pairs={3}
              />,
            ],
          },
          [<SeatRowsPlaceholder key="seats" />],
          // A live link's three acts.
          [
            <FactsPlaceholder
              key="link"
              pairs={2}
            />,
            { act: COPY.shared.withObject(COPY.account.address.link, "send") },
            { act: COPY.shared.withObject(COPY.account.address.link, "replace") },
            { act: COPY.shared.withObject(COPY.account.address.link, "withdraw") },
          ],
        ],
        danger: [
          { name: WORDS.austrittAct, consequence: WORDS.austrittRowLine, act: COPY.shared.verb.remove },
          {
            name: COPY.shared.withObject(COPY.shared.facts.team, "retire"),
            consequence: WORDS.retireConsequence,
            act: COPY.shared.verb.retire,
          },
        ],
      }}
      editor={readEditor(params)}
    />
  );
}

/** Where the link stands, by the season's press and the live link: a club the press passes over, none yet, or its mail. */
function linkStateOf({ skipped, invitation, paused }: FLTeamLinkState): Copy {
  if (skipped === "no_kontakt_block" || skipped === "no_confirmed_kontaktperson") return LINK_WORDS.noConfirmedAddress;
  if (invitation === null) return LINK_WORDS.noLinkYet;
  if (paused) return LINK_WORDS.registrierungPaused;
  return invitation.sent_at === null ? LINK_WORDS.linkNotSent : LINK_WORDS.linkSentOn(dayOf(invitation.sent_at));
}

/** The boxes of the club's row of the season, each lock read off what its write would refuse. */
function rowOf(read: FLTeamSaisonAdminResponse, membership: FLTeamMembership, link: FLTeamLinkState): TeamRow {
  const { saison, gruppen, gruppe_locked: drawn, taken_trikot_farben: taken } = read;
  const austritt = membership.austritt;
  const departed = austritt === null ? undefined : COPY.admin.spiel.departed;
  const end = saison.registrierung_end;
  const stands = austritt === null ? null : COPY.shared.austritt[austritt.type];
  const note =
    austritt !== null && stands !== null
      ? COPY.shared.austrittSince(stands.state, dayOf(austritt.date))
      : drawn && saison.begun
        ? LINK_WORDS.lockedSinceStart
        : undefined;
  return {
    saisonTitle: COPY.shared.saisonName(saison.id),
    ...(note === undefined ? {} : { note }),
    gruppen: gruppeOptions(gruppen, membership.gruppe),
    gruppeLocked: drawn || austritt !== null,
    ...(drawn && !saison.begun ? { gruppeNote: LINK_WORDS.lockedByDraw } : {}),
    colours: trikotOptions(taken),
    colourLocked: austritt !== null,
    austritt:
      austritt === null || stands === null
        ? null
        : [
            { label: WORDS.austrittType, value: stands.label },
            { label: WORDS.austrittFrom, value: { record: formatDate(dayOf(austritt.date)) }, figures: true },
            { label: COPY.admin.spiel.reason, value: { record: austritt.reason } },
          ],
    version: membership.version,
    seats: seatsOf(membership),
    invitation: {
      facts: [
        { label: COPY.admin.schiedsrichter.state, value: linkStateOf(link) },
        { label: WORDS.linkValidUntil, value: end === null ? COPY.shared.noValue : WORDS.registrierungEnd(dayOf(end)) },
      ],
      live: link.invitation?.id ?? null,
      ...(departed === undefined ? {} : { locked: departed }),
    },
    ...(departed === undefined ? {} : { sendLocked: departed }),
    exit:
      austritt !== null
        ? null
        : {
            earliest: dayOf(saison.start_date),
            today: dayIn(now()),
            ...(saison.begun ? {} : { locked: WORDS.fromStart }),
          },
  };
}

async function readEditor(params: Props["params"]) {
  const read = await find(params);
  if (read === null) notFound();

  const { team, saison, membership, link, retire_blocked_by: blocked } = read;
  const retired = team.inactive_since !== null;
  const row = membership === null || link === null ? null : rowOf(read, membership, link);
  // A finished season's rows are its table's and its podium's, and a retired club's page exists for its return.
  const closed = retired ? SERVER_COPY.refusalLine.team_retired : saison.status === "past" ? SERVER_COPY.refusalLine.saison_past : undefined;
  const chip = adminTeamChip(team.inactive_since, membership?.austritt?.type ?? null);

  return (
    <TeamEditor
      team={team.id}
      saison={saison.id}
      title={{ record: team.full_name }}
      {...(chip === undefined ? {} : { chip })}
      {...(closed === undefined ? {} : { closed })}
      {...(retired ? { closedChip: { tone: "neutral", label: COPY.shared.retired } } : {})}
      record={{ id: team.id, version: read.version, values: valuesOf(team, membership) }}
      save={saveTeam}
      rules={TEAM_SAVE_RULES}
      descriptionMax={TEAM_DESCRIPTION_MAX}
      seatRules={SEAT_RULES}
      austrittRules={AUSTRITT_RULES}
      retirement={retired ? { kind: "reactivate" } : { kind: "retire", ...(blocked === null ? {} : { locked: WORDS.retireLocked }) }}
      row={row}
    />
  );
}
