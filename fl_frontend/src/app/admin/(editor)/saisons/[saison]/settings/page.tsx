import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";

import { judgeAdminRequest } from "@/core/auth/guards";
import { COPY } from "@/core/copy";
import { dayOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getAdminSaison } from "@/features/saisons/queries";
import { SAISON_REQUIRED } from "@/features/saisons/required";
import { saisonChipOf } from "@/features/saisons/saisonState";
import { pageMetadata } from "@/shared/utils/metadata";

import { activateSaison, deleteSpielplan, drawSpielplan, recreateSpielplan, replaceTeam, swapGruppen } from "./saisonActs";
import { SaisonEditor } from "./SaisonEditor";
import { valuesOf } from "./saisonValues";
import { saveSaison } from "./saveSaison";

import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/settings">;

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

/** The season editor, on the season's one admin read. */
export default function SaisonSettingsPage({ params }: Props) {
  return <EditorShell editor={readEditor(params)} />;
}

async function readEditor(params: Props["params"]) {
  const [{ saison, teams, incoming_clubs, shapes }, judged] = await Promise.all([readSaison(params), judgeAdminRequest()]);
  // The frame's guard turned a refused session away before the page reads; an acting administrator holds a passkey,
  // signing in by it alone, so every act behind the touch asks it.
  const holder = "session" in judged ? judged.session.user.email : "";

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
        spielplan:
          saison.spielplan === null
            ? null
            : { spieltage: saison.spielplan.spieltage, spiele: saison.spielplan.spiele, drawnOn: dayOf(saison.spielplan.generated_at) },
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
      holder={holder}
      acts={{
        draw: drawSpielplan,
        recreate: recreateSpielplan,
        undraw: deleteSpielplan,
        activate: activateSaison,
        swap: swapGruppen,
        replace: replaceTeam,
      }}
      // A finished season takes no change of its rules, its draw or its clubs, so the editor opens on it read-only.
      {...(saison.status === "past" ? { closed: SERVER_COPY.refusalLine.saison_past } : {})}
    />
  );
}
