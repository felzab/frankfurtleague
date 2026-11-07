import { notFound } from "next/navigation";

import { CheckboxPlaceholder } from "@/kit/Checkbox";
import { ToggleBoxesPlaceholder } from "@/kit/ChoiceButtons";
import { EditorShell } from "@/kit/EditorShell";
import { FactsPlaceholder } from "@/kit/Facts";
import { FieldPlaceholder } from "@/kit/FieldPair";
import { TablePlaceholder } from "@/kit/Table";

import { judgeAdminRequest } from "@/core/auth/guards";
import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { FLSpielerStufe } from "@/core/generated/client/types";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getAdminSaison, getAdminSaisons } from "@/features/saisons/queries";
import { SAISON_REQUIRED } from "@/features/saisons/required";
import { saisonChipOf } from "@/features/saisons/saisonState";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

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
import type { TableHead } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/settings">;

const WORDS = COPY.admin.saison;
const TEAM = COPY.shared.facts.team;

/** The registration links' head, stated with the rows this page reads for it and drawn while they are read. */
const LINKS_HEAD: TableHead = { nameLabel: TEAM, columns: [{ key: "link", label: COPY.account.address.link }] };

/** One of the editor's selects of a few short choices while it is read. */
const SELECT = (
  <FieldPlaceholder
    key="select"
    width="fit"
  />
);

/** The season the address names, or the not-found page. */
async function readSaison(params: Props["params"]) {
  const { saison } = await params;
  const read = await getAdminSaison(saison);
  if (read === null) notFound();
  return read;
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(getAdminSaison(saison), (read) =>
    pageMetadata(parent, ROUTES.adminSaison, ROUTES.adminSaison.path(read.saison.id), { title: COPY.shared.saisonName(read.saison.id) }),
  );
}

/**
 * Why a danger act cannot run now, by the refusal its write would answer, which the read serves: never a rule of the
 * page's own. A code no line here words means a page older than the API, which the stale line says.
 */
function lockedOf(code: Code | null, status: FLSaisonStatus): Copy | undefined {
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
    case "spielplan_gruppen_off_rules":
      return WORDS.gruppenOffRules;
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
  if (row.skipped === "no_kontakt_block" || row.skipped === "no_confirmed_kontaktperson") return WORDS.noConfirmedAddress;
  if (!row.has_link) return WORDS.noLinkYet;
  return row.sent_at === null ? WORDS.linkNotSent : WORDS.linkSentOn(dayOf(row.sent_at));
}

/** The season editor, on the season's one admin read. */
export default function SaisonSettingsPage({ params }: Props) {
  return (
    <EditorShell
      // Each section in its fullest state, which no one season holds all at once: a running season's closed boxes, its draw
      // standing, and the rows of a season not yet the site's. Only the read says which one it is.
      wait={{
        sections: [
          { note: WORDS.startFixed, rows: [{ rows: 2, width: "C10" }] },
          { note: WORDS.lockedSinceStart, rows: ["subhead", { rows: 3, width: "C2" }, SELECT, "subhead", { rows: 2, width: "C2" }] },
          { note: WORDS.lockedByDraw, rows: [{ rows: 2, width: "C2" }, SELECT] },
          [
            <FieldPlaceholder
              key="maxKader"
              width="C2"
            />,
            <ToggleBoxesPlaceholder
              key="stufen"
              count={Object.values(FLSpielerStufe).length}
            />,
          ],
          [
            { rows: 2, width: "C10" },
            <CheckboxPlaceholder
              key="paused"
              label={WORDS.bewerbungPaused}
            />,
          ],
          [
            <FieldPlaceholder
              key="end"
              width="C10"
            />,
            <CheckboxPlaceholder
              key="paused"
              label={WORDS.registrierungPaused}
            />,
          ],
          [
            <FactsPlaceholder
              key="spielplan"
              pairs={3}
            />,
          ],
          { note: WORDS.lockedSinceStart, rows: ["field", "field", { act: COPY.shared.withObject(WORDS.gruppen, "swap") }] },
          { note: WORDS.lockedSinceStart, rows: ["field", "field", { act: COPY.shared.withObject(TEAM, "replace") }] },
          [
            <TablePlaceholder
              key="links"
              head={LINKS_HEAD}
              rows={24}
              bare
              linked={false}
            />,
            { act: COPY.shared.withObject(WORDS.registrierungslinks, "send") },
          ],
        ],
        danger: [
          {
            name: COPY.shared.withObject(COPY.page.spielplan, "recreate"),
            consequence: WORDS.recreateConsequence,
            act: COPY.shared.verb.recreate,
          },
          { name: COPY.shared.withObject(COPY.page.spielplan, "delete"), consequence: WORDS.deleteConsequence, act: COPY.shared.verb.delete },
          {
            name: COPY.shared.withObject(WORDS.onto("2027"), "activate"),
            consequence: WORDS.activateConsequence("2027"),
            act: COPY.shared.verb.activate,
          },
        ],
      }}
      editor={readEditor(params)}
    />
  );
}

async function readEditor(params: Props["params"]) {
  // The frame's own season list, which the switch's question names the season the site leaves from, beside the view read.
  const [{ saison, teams, incoming_teams, shapes, spielplan, refusals, invitations }, { saisons }, judged] = await Promise.all([
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
          spielplan === null ? null : { spieltage: spielplan.spieltage, spiele: spielplan.spiele, drawnOn: dayOf(spielplan.generated_at) },
        locked: {
          activate: lockedOf(refusals.activate, saison.status),
          create: lockedOf(refusals.create, saison.status),
          recreate: lockedOf(refusals.recreate, saison.status),
          undraw: lockedOf(refusals.undraw, saison.status),
        },
      }}
      shapes={shapes}
      clubs={teams.map((team) => ({
        id: team.team_id,
        name: team.name,
        gruppe: team.gruppe,
        groupTakenPlace: team.group_spiel_taken_place,
        takenPlace: team.spiel_taken_place,
      }))}
      incoming={incoming_teams.map((club) => ({ id: club.id, name: club.name }))}
      links={{
        head: LINKS_HEAD,
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
