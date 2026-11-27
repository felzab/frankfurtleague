import { cache } from "react";
import { notFound } from "next/navigation";

import { boxRulesOf } from "@/core/action";
import { COPY } from "@/core/copy/shared";
import { ContractBreakError } from "@/core/errors";
import { dayOf, timeOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { CLOSED_LINEUP_WORDS, LINEUP_WORDS, playersOf } from "@/features/aufstellungen/players";
import { getAufstellung } from "@/features/aufstellungen/queries";
import { eventChipOf, matchdayOf, matchName } from "@/features/spiele/blocks";
import { StatusPage } from "@/kit/StatusPage";
import { adminIdParamOf } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { AdminAufstellung } from "./AdminAufstellung";
import { saveAufstellung } from "./saveAufstellung";

import type { Copy } from "@/core/copy";
import type { FLAufstellungResponse } from "@/core/generated/client/types";
import type { Metadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/spiele/[spiel]/aufstellung/[team]">;

const read = cache(getAufstellung);

/**
 * The line-up the address names, as every season page reads its record: `null` for a malformed match or club id, for a
 * match that does not field the club, and for one of another season, each of which the page says is not found.
 */
async function findAufstellung(params: Props["params"]): Promise<FLAufstellungResponse | null> {
  const spiel = await adminIdParamOf(params, "spiel");
  const team = await adminIdParamOf(params, "team");
  const { saison } = await params;
  const found = spiel === null || team === null ? null : await read(spiel, team);
  return found === null || found.spiel.saison_id !== saison ? null : found;
}

/** The line-up's title, its tab's and its strip's: the club whose line-up it is, as the match editor's link to it reads. */
function titleOf({ spiel, team_id }: FLAufstellungResponse): Copy {
  const team = [spiel.team1, spiel.team2].find((side) => side?.team_id === team_id);
  if (team === undefined || team === null) throw new ContractBreakError("A line-up's read named a club its fixture does not field.");
  return ROUTES.adminAufstellung.title({ record: team.name });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataFor(findAufstellung(params), (found) =>
    pageMetadata(ROUTES.adminAufstellung, ROUTES.adminAufstellung.path(found.spiel.saison_id, found.spiel.spiel_id, found.team_id), {
      title: titleOf(found),
    }),
  );
}

/**
 * The line under the title: the match, since the title names one club, the matchday as the Spiele list names it, and
 * when the match is played. No due day: the league enters a line-up whenever the match has its slot.
 */
function leadOf({ spiel }: FLAufstellungResponse): Copy {
  return COPY.shared.line([
    matchName(spiel.team1?.name ?? null, spiel.team2?.name ?? null),
    matchdayOf(spiel, spiel),
    COPY.spielplan.when(dayOf(spiel.date), timeOf(spiel.time)),
  ]);
}

/**
 * One club's line-up for a match as the league enters it, on one read of the fixture, the squad and the stored line-up:
 * the editor, open before the team's lock and after it alike, since the clock locks nothing for the league. A match with
 * no day or hour takes no line-up, so the page says that its date is open, or its day and that its hour is, as the
 * club's own line-up page words it, and leads to the match editor, where the slot is set. A finished season's line-ups take no
 * write (`saison_past`), so the editor opens on one read-only, as the match editor does, whatever became of the match's
 * slot since.
 */
export default async function AdminAufstellungPage({ params }: Props) {
  const found = await findAufstellung(params);
  if (found === null) notFound();

  const { spiel } = found;
  const title = titleOf(found);
  const closed = found.saison_status === "past" ? SERVER_COPY.refusalLine.saison_past : undefined;
  if (closed === undefined && found.marks === null) {
    const day = dayOf(spiel.date);
    return (
      <StatusPage
        scope="area"
        title={title}
        card={{
          tone: "info",
          // A match without marks has no kick-off: undated, its date is open; dated, its hour is, as the club's page says.
          title: day === null ? COPY.spielplan.when(null, null) : SERVER_COPY.season.spiel.timeOpen(COPY.spielplan.when(day, null)),
          next: { label: COPY.shared.toSpiel, href: ROUTES.adminSpiel.path(spiel.saison_id, spiel.spiel_id) },
        }}
      />
    );
  }
  return (
    <AdminAufstellung
      rules={boxRulesOf(saveAufstellung)}
      team={found.team_id}
      title={title}
      // What befell the match, after the title as every match block draws it.
      {...(spiel.sonderereignis === null
        ? {}
        : { chip: eventChipOf(spiel.sonderereignis, spiel.team1?.name ?? null, spiel.team2?.name ?? null) })}
      lead={leadOf(found)}
      aufstellung={{ id: found.spiel.spiel_id, version: found.version, spieler: found.spieler }}
      players={playersOf(found)}
      words={closed === undefined ? LINEUP_WORDS : CLOSED_LINEUP_WORDS}
      // A finished season's line-up takes no write again, so its acts are left out, the lock line saying why.
      {...(closed === undefined ? {} : { closed, acts: "out" })}
    />
  );
}
