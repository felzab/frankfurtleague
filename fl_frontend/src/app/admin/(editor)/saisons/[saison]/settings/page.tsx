import { notFound } from "next/navigation";

import { CheckboxPlaceholder } from "@/kit/Checkbox";
import { ToggleBoxesPlaceholder } from "@/kit/ChoiceButtons";
import { EditorShell } from "@/kit/EditorShell";
import { FactsPlaceholder } from "@/kit/Facts";
import { FieldPlaceholder } from "@/kit/FieldPair";
import { FieldRows } from "@/kit/FieldRows";
import { SectionPlaceholder } from "@/kit/Section";
import { NOT_SENT_CHIP, SENT_CHIP } from "@/kit/stateChips";
import { TablePlaceholder } from "@/kit/Table";

import { getAdminSession } from "@/core/auth/guards";
import { COPY } from "@/core/copy";
import { dayOf, formatDate } from "@/core/format";
import { FLSpielerStufe } from "@/core/generated/client/types";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getAdminSaison, getAdminSaisons } from "@/features/saisons/queries";
import { SAISON_REQUIRED } from "@/features/saisons/required";
import { saisonChipOf } from "@/features/saisons/saisonState";
import { adminTeamChip } from "@/features/teams/constants";
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
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/settings">;

const WORDS = COPY.admin.saison;
const TEAM = COPY.shared.facts.team;

/**
 * The registration links' head, stated with the rows this page reads for it and drawn while they are read. The rows
 * open nothing, so on a phone a sent row's line says the day the „Gesendet am“ column would.
 */
const LINKS_HEAD: TableHead = {
  nameLabel: TEAM,
  linked: false,
  state: { label: COPY.admin.schiedsrichter.state },
  line: "phone",
  // Secondary, as every list's day column: on a phone the row keeps its name and its chip.
  columns: [{ key: "sentOn", label: WORDS.sentOn, hideOnPhone: true, width: "date" }],
};

/** One of the editor's selects of a few short choices while it is read. */
const SELECT = <FieldPlaceholder key="select" />;

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
      return WORDS.noDrawLocked;
    case "activate_spieltage_undated":
      return WORDS.undatedLocked;
    case "activate_saison_unfinished":
      return WORDS.unfinishedLocked;
    case "spielplan_berichte_submitted":
      return WORDS.reportsHold;
    case "spielplan_gruppen_off_rules":
      return WORDS.gruppenOffRulesLocked;
    // One code for both ways the planning window closes: the season went live, or a match of it holds an entry.
    case "spielplan_replace_outside_its_window":
    case "spielplan_undraw_outside_its_window":
      return status === "future" ? WORDS.entriesHold : WORDS.lockedSinceActivation;
    default:
      return COPY.shared.failure.stale;
  }
}

/**
 * A team's registration link as its row's chip states it, the record's own state whatever the season's: the club out of
 * the season in its exit's red; the press passing it over for want of a confirmed address, or no link minted yet, each
 * amber, waiting on a person or a press as an unsent link does; else unsent or sent.
 */
function linkOf(row: FLInvitationLinkRow, team: FLSaisonAdminTeam | undefined): ChipProps {
  const out = team?.austritt == null ? undefined : adminTeamChip(null, team.austritt.type);
  if (out !== undefined) return out;
  if (row.skipped === "no_kontakt_block" || row.skipped === "no_confirmed_kontaktperson") {
    return { tone: "warn", label: WORDS.noConfirmedAddress };
  }
  if (!row.has_link) return { tone: "warn", label: WORDS.noLinkYet };
  return row.sent_at === null ? NOT_SENT_CHIP : SENT_CHIP;
}

/** The season editor, on the season's one admin read. */
export default function SaisonSettingsPage({ params }: Props) {
  return (
    <EditorShell
      // Each part in its fullest state, which no one season holds all at once: its draw standing, and the rows of a
      // season not yet the site's. Only the read says which one it is.
      wait={{
        sections: [
          [{ rows: 2, holds: "day" }],
          ["subhead", { rows: 3, holds: "count" }, SELECT, "subhead", { rows: 2, holds: "count" }],
          [
            <FieldRows key="counts">
              <FieldPlaceholder holds={2} />
              <FieldPlaceholder holds={2} />
              <FieldPlaceholder
                kind="choice"
                holds={2}
              />
            </FieldRows>,
          ],
          [
            <FieldPlaceholder
              key="maxKader"
              holds={2}
            />,
            <ToggleBoxesPlaceholder
              key="stufen"
              count={Object.values(FLSpielerStufe).length}
            />,
          ],
          [
            { rows: 2, holds: "day" },
            <CheckboxPlaceholder
              key="paused"
              label={WORDS.bewerbungPaused}
            />,
          ],
          [
            <FieldPlaceholder key="end" />,
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
          ["field", "field", { acts: [COPY.shared.withObject(WORDS.gruppen, "swap")] }],
          ["field", "field", { acts: [COPY.shared.withObject(TEAM, "replace")] }],
          {
            block: (
              <SectionPlaceholder
                list={
                  <TablePlaceholder
                    head={LINKS_HEAD}
                    rows={24}
                    bare
                  />
                }
                rows={[{ acts: [COPY.shared.withObject(WORDS.invitations, "send")] }]}
              />
            ),
          },
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
  const [{ saison, teams, incoming_teams, shapes, spielplan, refusals, invitations }, { saisons }, session] = await Promise.all([
    readSaison(params),
    getAdminSaisons(),
    getAdminSession(),
  ]);
  // The page's read turned a refused session away to the sign-in before this line; an acting administrator signs in
  // by passkey alone, so every act behind the touch asks it.
  const holder = session?.user.email ?? "";
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
      clubs={teams.map((team) => ({ id: team.team_id, name: team.name, gruppe: team.gruppe }))}
      incoming={incoming_teams.map((club) => ({ id: club.id, name: club.name }))}
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
            ),
            ...(sent === null ? {} : { phoneLine: WORDS.linkSentOn(sent) }),
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
