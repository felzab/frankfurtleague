import Link from "next/link";

import { CardGrid } from "@/shared/components/ui/CardGrid";
import { EmptyState } from "@/shared/components/ui/EmptyState";
import { CARDS_CASCADE } from "@/shared/components/ui/motion";
import { withSaisonId } from "@/shared/utils/saisonHref";

import { TeamCard } from "../ui/TeamCard";

import type { FLTeam } from "../../schemas";

// Each step is n columns of 14.25rem plus the gaps between them: 14.25rem is the narrowest `TeamCard`, at
// a quarter-rem step, still holding its three chips on one line with a three-digit goal count.
const COLUMNS = "@min-[30rem]:grid-cols-2 @min-[45.75rem]:grid-cols-3";

export function TeamsGrid({
  teams,
  urlPrefix,
  saisonId,
  isFinishedSaison,
}: {
  teams: FLTeam[];
  urlPrefix: string;
  /**
   * The season the list was read for, `undefined` for the running one. Carried into every card's
   * link: the club page joins strictly, so a club missing from the running season opens on „nicht gefunden“.
   */
  saisonId: string | undefined;
  isFinishedSaison: boolean;
}) {
  // Season-scoped: an empty list usually means this season has no teams yet, not that none exist.
  if (teams.length === 0) {
    // A finished season's list is not still to come, so it takes no `noch` and no hint.
    return isFinishedSaison ? (
      <EmptyState title="Für diese Saison gibt es keine Teams." />
    ) : (
      <EmptyState
        title="Für diese Saison sind noch keine Teams eingetragen."
        hint="Sobald Teams gemeldet sind, erscheinen sie hier."
      />
    );
  }

  return (
    // The cascade is keyed off `role="listitem"`, not the card type, so every grid arrives alike.
    <CardGrid
      columns={COLUMNS}
      role="list"
      className={CARDS_CASCADE}>
      {teams.map((teamData) => (
        // On the wrapper, never on the <Link>: an explicit role replaces the implicit `link` one,
        // dropping the card out of a screen reader's list of links.
        <div
          role="listitem"
          key={teamData.id}
          className="size-full">
          <Link
            href={withSaisonId(`${urlPrefix}/${teamData.id}`, saisonId)}
            className="block size-full rounded-2xl">
            <TeamCard teamData={teamData} />
          </Link>
        </div>
      ))}
    </CardGrid>
  );
}
