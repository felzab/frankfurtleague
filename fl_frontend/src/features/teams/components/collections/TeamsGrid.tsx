import Link from "next/link";

import { EmptyState } from "@/shared/components/ui/EmptyState";
import { CARDS_CASCADE } from "@/shared/components/ui/motion";

import { TeamCard } from "../ui/TeamCard";

import type { FLTeam } from "../../schemas";

export function TeamsGrid({ teams, urlPrefix }: { teams: FLTeam[]; urlPrefix: string }) {
  // Season-scoped: an empty list usually means this season has no teams yet, not that none exist
  // anywhere -- selecting a future season in the SaisonSelector produces exactly that.
  if (teams.length === 0) {
    return (
      <EmptyState
        title="Für diese Saison sind noch keine Teams eingetragen."
        hint="Sobald Teams gemeldet sind, erscheinen sie hier."
      />
    );
  }

  return (
    // The cascade is keyed off `role="listitem"`, not off the card type, so a grid of `TeamCard`s
    // arrives exactly like a grid of `SpielCard`s. This grid had no entrance at all.
    <div
      role="list"
      className={`${CARDS_CASCADE} max-w-page grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3`}>
      {teams.map((teamData) => (
        // The role goes on the wrapper, never on the <Link>: an explicit role replaces the implicit
        // `link` one, which would drop the card out of a screen reader's list of links.
        <div
          role="listitem"
          key={teamData.id}
          className="size-full">
          <Link
            href={`${urlPrefix}/${teamData.id}`}
            className="block size-full rounded-2xl">
            <TeamCard teamData={teamData} />
          </Link>
        </div>
      ))}
    </div>
  );
}
