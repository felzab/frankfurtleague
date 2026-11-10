import { RailFrame } from "@/kit/RailFrame";
import { RailFrameBoundary } from "@/kit/RailFrameBoundary";

import { rolesOf } from "@/core/roles";
import { ROUTES } from "@/core/routes";
import { getSubjectSession } from "@/core/subject";
import { readAccount } from "@/features/account/account";

import { AREA_HOME } from "../areaHome";

import type { TeamSeat } from "@/features/roles/resolvers";
import type { FrameSaisons, RailGroup } from "@/kit/FrameNav";
import type { ReactNode } from "react";

/** A team's four pages, each in the team and the season the address names, which the frame fills in. */
const RAIL_GROUPS: RailGroup[] = [
  {
    entries: [
      { id: "overview", label: ROUTES.teamOverview.title, team: "teamOverview", icon: "overview" },
      { id: "spiele", label: ROUTES.teamSpiele.title, team: "teamSpiele", icon: "spielplan" },
      { id: "kader", label: ROUTES.teamKader.title, team: "teamKader", icon: "teams" },
      { id: "registrierungen", label: ROUTES.teamRegistrierungen.title, team: "teamRegistrierungen", icon: "registrierungen" },
    ],
  },
];

/** The phone bar holds all four, the account taking the fifth place. */
const BAR = ["overview", "spiele", "kader", "registrierungen"] as const;

type Teams = Extract<FrameSaisons, { teams: unknown }>["teams"];

/**
 * Every team the person holds a seat on, each with the seasons of those seats, the newest first, and the season its
 * pages work in where the address names one the person does not hold there: the running one where they hold it, else
 * the newest. None for a session turned away, whose page sends it to sign in.
 */
async function readTeams(): Teams {
  const subject = await getSubjectSession();
  if (subject === null) return [];

  const byTeam = new Map<string, [TeamSeat, ...TeamSeat[]]>();
  for (const role of rolesOf(subject).roles) {
    if (role.kind !== "kontakt") continue;
    const held = byTeam.get(role.team_id);
    if (held === undefined) byTeam.set(role.team_id, [role]);
    else held.push(role);
  }

  return [...byTeam].map(([team, held]) => {
    const newest = held.reduce((best, seat) => (seat.saison_id.localeCompare(best.saison_id) > 0 ? seat : best));
    const ids = [...new Set(held.map((seat) => seat.saison_id))].sort((one, other) => other.localeCompare(one));
    return {
      team,
      // Session 8: each season's span is its seat's own dates, written by `formatPeriod`.
      entries: ids.map((id) => ({ id, span: "" })),
      standard: (held.find((seat) => seat.saison_status === "active") ?? newest).saison_id,
    };
  });
}

/**
 * The frame of a team's pages, for the team's contact seats. It stands above the team and the season of the address,
 * whose subtrees Next keys on their values, so a switch of season or of team remounts the page alone and keeps the
 * frame; it is handed neither, and its menus read both from the address on the client. It is drawn without waiting for
 * the session, the seasons and the account streaming into their places, and judges no page: each team page's read asks
 * for the person's seat itself (`fl_frontend/src/features/roles/resolvers.ts :: requireTeamSeats`). The phone's band
 * and bar are the route groups' (`RailColumn`): the line-up lies in `(editor)`, every other page in `(liste)`.
 */
export default function TeamLayout({ children }: { children: ReactNode }) {
  return (
    // A failed read of the frame's own is answered in the rail frame: this segment's `error.tsx` stands inside this layout.
    <RailFrameBoundary
      groups={RAIL_GROUPS}
      bar={BAR}
      next={AREA_HOME}>
      <RailFrame
        groups={RAIL_GROUPS}
        bar={BAR}
        saison={{ teams: readTeams(), home: "teamOverview" }}
        // The row's second line is the place's own, the team's Kürzel and the seats held there: the frame names no team.
        foot={{ kind: "account", account: readAccount() }}
        columnInLayouts>
        {children}
      </RailFrame>
    </RailFrameBoundary>
  );
}
