import { PAGE_RISE } from "@/shared/components/ui/motion";

import { TeamsGrid } from "../collections/TeamsGrid";

import type { FLTeam } from "../../schemas";

export function TeamSelectionView({ urlPrefix, teams }: { urlPrefix: string; teams: FLTeam[] }) {
  return (
    /* Backs both /dashboard/teams and /dashboard/spieler, so its entrance covers two routes rather
       than one. The rise carries the title block; the grid inside cascades on its own, the same split
       `SpielplanView` uses. */
    <div className={`${PAGE_RISE} relative flex w-full flex-1 flex-col items-center pt-6`}>
      <TeamsGrid
        urlPrefix={urlPrefix}
        teams={teams}
      />
    </div>
  );
}
