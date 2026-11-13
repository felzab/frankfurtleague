import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";

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

import { linkFactsOf } from "./linkFacts";
import { saveTeam } from "./saveTeam";
import { seatsOf } from "./seats";
import { TeamEditor } from "./TeamEditor";
import { valuesOf } from "./teamValues";

import type { FLTeamLinkState, FLTeamMembership, FLTeamSaisonAdminResponse } from "@/core/generated/client/types";
import type { Metadata, ResolvingMetadata } from "next";
import type { TeamRow } from "./TeamEditor";

type Props = PageProps<"/admin/saisons/[saison]/teams/[team]">;

const WORDS = COPY.admin.team;

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
  return <EditorShell editor={readEditor(params)} />;
}

/** The boxes of the club's row of the season, each lock read off what its write would refuse. */
function rowOf(read: FLTeamSaisonAdminResponse, membership: FLTeamMembership, link: FLTeamLinkState): TeamRow {
  const { saison, gruppen, gruppe_locked: drawn, taken_trikot_farben: taken } = read;
  const austritt = membership.austritt;
  const departed = austritt === null ? undefined : COPY.admin.spiel.departed;
  const stands = austritt === null ? null : COPY.shared.austritt[austritt.type];
  return {
    saisonTitle: COPY.shared.saisonName(saison.id),
    gruppen: gruppeOptions(gruppen, membership.gruppe),
    // The exit fixes the group whether or not a draw stands too, so the lock says the one reason for both fields.
    gruppeLocked: austritt !== null ? "departed" : drawn ? "byDraw" : null,
    colours: trikotOptions(taken),
    colourLocked: austritt !== null ? "departed" : null,
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
      facts: linkFactsOf(link, saison),
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
            recipients: read.austritt_recipients,
            ...(saison.begun ? {} : { locked: COPY.admin.fromStart }),
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
      chip={chip}
      {...(closed === undefined ? {} : { closed })}
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
