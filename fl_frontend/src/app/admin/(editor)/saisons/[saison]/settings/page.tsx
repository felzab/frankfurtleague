import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";

import { judgeAdminRequest } from "@/core/auth/guards";
import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getAdminSaison, getAdminSaisons } from "@/features/saisons/queries";
import { SAISON_REQUIRED } from "@/features/saisons/required";
import { saisonChipOf } from "@/features/saisons/saisonState";
import { pageMetadata } from "@/shared/utils/metadata";

import {
  activateSaison,
  deleteSpielplan,
  drawSpielplan,
  recreateSpielplan,
  replaceTeam,
  sendRegistrierungslinks,
  swapGruppen,
} from "./saisonActs";
import { SaisonEditor } from "./SaisonEditor";
import { valuesOf } from "./saisonValues";
import { saveSaison } from "./saveSaison";

import type { Copy, Words } from "@/core/copy";
import type { Code, FLInvitationLinkRow, FLSaisonAdminTeam, FLSaisonStatus } from "@/core/generated/client/types";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/settings">;

const WORDS = COPY.admin.saison;

/** The season the address names, or the not-found page, the tab's title included. */
async function readSaison(params: Props["params"]) {
  const { saison } = await params;
  const read = await getAdminSaison(saison);
  if (read === null) notFound();
  return read;
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await readSaison(params);
  return pageMetadata(parent, ROUTES.adminSaison, ROUTES.adminSaison.path(saison.id), { title: COPY.shared.saisonName(saison.id) });
}

/**
 * Why a danger act cannot run now, by the refusal its write would answer, which the read serves: never a rule of the
 * page's own. A code no line here words means a page older than the API, which the stale line says.
 */
function blockedOf(code: Code | null, status: FLSaisonStatus): Copy | undefined {
  switch (code) {
    case null:
      return undefined;
    case "activate_target_undrawn":
      return WORDS.noDraw;
    case "activate_spieltage_undated":
      return WORDS.undated;
    case "activate_saison_unfinished":
      return WORDS.unfinished;
    case "spielplan_berichte_submitted":
      return WORDS.reportsHold;
    // One code for both ways the planning window closes: the season went live, or a match of it holds an entry.
    case "spielplan_replace_outside_its_window":
    case "spielplan_undraw_outside_its_window":
      return status === "future" ? WORDS.entriesHold : WORDS.lockedSinceActivation;
    default:
      return COPY.shared.failure.stale;
  }
}

/** A team's registration link as its row states it: the club gone, the press passing it over, or its link's state. */
function linkOf(row: FLInvitationLinkRow, team: FLSaisonAdminTeam | undefined): Words {
  if (team?.austritt != null) return COPY.shared.austritt[team.austritt.type].state;
  if (row.skipped === "kontakte_barred") return WORDS.addressBarred;
  if (row.skipped === "no_kontaktblock" || row.skipped === "no_confirmed_kontaktperson") return WORDS.noConfirmedAddress;
  if (!row.has_link) return WORDS.noLinkYet;
  return row.sent_at === null ? WORDS.linkNotSent : WORDS.linkSentOn(dayOf(row.sent_at));
}

/** The season editor, on the season's one admin read. */
export default function SaisonSettingsPage({ params }: Props) {
  return <EditorShell editor={readEditor(params)} />;
}

async function readEditor(params: Props["params"]) {
  // The frame's own season list, which the switch's question names the season the site leaves from, beside the view read.
  const [{ saison, teams, incoming_clubs, shapes, refusals, invitations }, { saisons }, judged] = await Promise.all([
    readSaison(params),
    getAdminSaisons(),
    judgeAdminRequest(),
  ]);
  // The page's read turned a refused session away to the sign-in before this line; an acting administrator signs in
  // by passkey alone, so every act behind the touch asks it.
  const holder = "session" in judged ? judged.session.user.email : "";
  // The teams the registration links' press would mail now, by the press's own plan.
  const mailed = invitations.filter((row) => row.skipped === null);

  return (
    <SaisonEditor
      saison={saison.id}
      title={COPY.shared.saisonName(saison.id)}
      chip={saisonChipOf(saison)}
      record={{ id: saison.id, version: saison.version, values: valuesOf(saison) }}
      save={saveSaison}
      required={SAISON_REQUIRED}
      facts={{
        begun: saison.begun,
        takenPlace: saison.taken_place,
        isCurrent: saison.status === "active",
        siteShows: saisons.find((listed) => listed.status === "active")?.id ?? null,
        spielplan:
          saison.spielplan === null
            ? null
            : { spieltage: saison.spielplan.spieltage, spiele: saison.spielplan.spiele, drawnOn: dayOf(saison.spielplan.generated_at) },
        blocked: {
          activate: blockedOf(refusals.activate, saison.status),
          recreate: blockedOf(refusals.recreate, saison.status),
          undraw: blockedOf(refusals.undraw, saison.status),
        },
      }}
      shapes={shapes}
      clubs={teams.map((team) => ({
        id: team.team_id,
        name: team.name,
        gruppe: team.gruppe,
        groupTakenPlace: team.group_fixture_taken_place,
        takenPlace: team.fixture_taken_place,
      }))}
      incoming={incoming_clubs.map((club) => ({ id: club.id, name: club.name }))}
      links={{
        rows: invitations.map((row) => ({
          id: row.team_id,
          name: { record: row.team_name },
          cells: {
            link: linkOf(
              row,
              teams.find((team) => team.team_id === row.team_id),
            ),
          },
        })),
        mailed: mailed.length,
        replacing: mailed.some((row) => row.replaced_link),
      }}
      holder={holder}
      acts={{
        draw: drawSpielplan,
        recreate: recreateSpielplan,
        undraw: deleteSpielplan,
        activate: activateSaison,
        swap: swapGruppen,
        replace: replaceTeam,
        sendLinks: sendRegistrierungslinks,
      }}
      // A finished season takes no change of its rules, its draw or its clubs, so the editor opens on it read-only.
      {...(saison.status === "past" ? { closed: SERVER_COPY.refusalLine.saison_past } : {})}
    />
  );
}
