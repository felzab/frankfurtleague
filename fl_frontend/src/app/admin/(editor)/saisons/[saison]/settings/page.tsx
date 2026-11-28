import { notFound } from "next/navigation";

import { boxRulesOf } from "@/core/action";
import { getAdminHolder } from "@/core/auth/guards";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { dayOf, formatDate } from "@/core/format";
import { ownKeyOf } from "@/core/ownKeyOf";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getAdminSaison, getAdminSaisons } from "@/features/saisons/queries";
import { saisonChipOf } from "@/features/saisons/saisonState";
import { adminTeamChip } from "@/features/teams/constants";
import { NOT_SENT_CHIP, outOfPlayChip, SENT_CHIP } from "@/kit/stateChips";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { activateSaison, deleteSpielplan, drawSpielplan, recreateSpielplan, replaceTeam, sendInvitations, swapGruppen } from "./saisonActs";
import { SaisonEditor } from "./SaisonEditor";
import { valuesOf } from "./saisonValues";
import { saveSaison } from "./saveSaison";

import type { Copy } from "@/core/copy";
import type { Code, FLInvitationLinkRow, FLSaisonAdminTeam, FLSaisonStatus } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Metadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/settings">;

const WORDS = ADMIN_COPY.saison;
const TEAM = COPY.shared.facts.team;

/**
 * The registration links' head. The rows open nothing, so on a phone a sent row's line says the day the „Gesendet am“
 * column would.
 */
const LINKS_HEAD: TableHead = {
  nameLabel: TEAM,
  state: { label: COPY.shared.facts.state },
  // Secondary, as every list's day column: on a phone the row keeps its name and its chip.
  columns: [{ key: "sentOn", label: WORDS.sentOn, hideOnPhone: true, onLine: "labelled", width: "date" }],
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(getAdminSaison(saison), (read) =>
    pageMetadata(ROUTES.adminSaison, ROUTES.adminSaison.path(read.saison.id), { title: COPY.shared.saisonName(read.saison.id) }),
  );
}

/**
 * Why a danger act cannot run now, by the refusal its write would answer, which the read serves: never a rule of the
 * page's own. The planning window's codes say which way it closed by the season's status, a planned season's matches
 * holding an entry or the season gone live. A code the table holds no phrase for means a page older than the API.
 */
function lockedOf(code: Code | null, status: FLSaisonStatus): Copy | undefined {
  if (code === null) return undefined;
  if (!ownKeyOf(WORDS.locks, code)) return WORDS.lockedOtherwise;
  const lock = WORDS.locks[code];
  return typeof lock === "function" ? lock(status === "future") : lock;
}

/**
 * A team's registration link as its row's chip states it, the record's own state whatever the season's: the club out of
 * the season in its exit's red, else what the link waits on, else sent. A finished season's press is shut, so nothing a
 * link waits on can follow there: its waiting states draw grey, as every state out of play does.
 */
function linkOf(row: FLInvitationLinkRow, team: FLSaisonAdminTeam | undefined, status: FLSaisonStatus): ChipProps {
  const out = team?.austritt == null ? undefined : adminTeamChip(null, team.austritt.type);
  if (out !== undefined) return out;
  const waiting = waitingOf(row);
  if (waiting === null) return SENT_CHIP;
  return status === "past" ? outOfPlayChip(waiting) : waiting;
}

/**
 * What a team's link waits on, each amber as a state waiting on a person or a press: the press passing it over for want
 * of a confirmed address, no link minted yet, or its mail; null once it is mailed.
 */
function waitingOf(row: FLInvitationLinkRow): ChipProps | null {
  if (row.skipped === "no_kontakt_block" || row.skipped === "no_confirmed_kontaktperson") {
    return { tone: "warn", label: WORDS.noConfirmedAddress };
  }
  if (!row.has_link) return { tone: "warn", label: WORDS.noLinkYet };
  return row.sent_at === null ? NOT_SENT_CHIP : null;
}

export default async function SaisonSettingsPage({ params }: Props) {
  const { saison: id } = await params;
  // The frame's own season list, which the switch's question names the season the site leaves from, beside the view read.
  const [read, { saisons }, holder] = await Promise.all([getAdminSaison(id), getAdminSaisons(), getAdminHolder()]);
  if (read === null) notFound();
  const { saison, teams, incoming_teams, shapes, spielplan, refusals, invitations } = read;
  // The teams the registration links' press would mail now, by the press's own plan.
  const mailed = invitations.filter((row) => row.skipped === null);

  return (
    <SaisonEditor
      saison={saison.id}
      title={COPY.shared.saisonName(saison.id)}
      chip={saisonChipOf(saison)}
      record={{ id: saison.id, version: saison.version, values: valuesOf(saison) }}
      save={saveSaison}
      rules={boxRulesOf(saveSaison)}
      facts={{
        begun: saison.begun,
        takenPlace: saison.taken_place,
        isCurrent: saison.status === "active",
        siteShows: saisons.find((listed) => listed.status === "active")?.id ?? null,
        spielplan:
          spielplan === null ? null : { spieltage: spielplan.spieltage, spiele: spielplan.spiele, drawnOn: dayOf(spielplan.generated_at) },
        locked: {
          activate: lockedOf(refusals.activate, saison.status),
          create: lockedOf(refusals.create, saison.status),
          recreate: lockedOf(refusals.recreate, saison.status),
          undraw: lockedOf(refusals.undraw, saison.status),
        },
      }}
      shapes={shapes}
      teams={teams.map((team) => ({ id: team.team_id, name: team.name, gruppe: team.gruppe }))}
      incoming={incoming_teams.map((team) => ({ id: team.id, name: team.name }))}
      links={{
        head: LINKS_HEAD,
        rows: invitations.map((row): TableRow => {
          const sent = dayOf(row.sent_at);
          return {
            id: row.team_id,
            name: { record: row.team_name },
            chip: linkOf(
              row,
              teams.find((team) => team.team_id === row.team_id),
              saison.status,
            ),
            cells: sent === null ? {} : { sentOn: { record: formatDate(sent) } },
          };
        }),
        mailed: mailed.length,
      }}
      holder={holder}
      acts={{
        draw: drawSpielplan,
        recreate: recreateSpielplan,
        undraw: deleteSpielplan,
        activate: activateSaison,
        swap: swapGruppen,
        replace: replaceTeam,
        sendLinks: sendInvitations,
      }}
      // A finished season takes no change of its rules, its draw or its clubs, so the editor opens on it read-only.
      {...(saison.status === "past" ? { closed: SERVER_COPY.refusalLine.saison_past } : {})}
    />
  );
}
