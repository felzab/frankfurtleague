import { PAGE_RISE } from "@/shared/components/ui/motion";

import { TeamsGrid } from "../collections/TeamsGrid";

import type { FLTeam } from "../../schemas";

export function TeamSelectionView({ urlPrefix, teams }: { urlPrefix: string; teams: FLTeam[] }) {
  return (
    /* Backs BOTH /dashboard/teams and /dashboard/spieler, which is why its having no entrance was
       two routes short of the rest of the nav rather than one. The rise carries the title block; the
       grid inside cascades on its own, the same split `SpielplanView` uses. */
    <div className={`${PAGE_RISE} relative flex w-full flex-1 flex-col items-center pt-6`}>
      <TeamsGrid
        urlPrefix={urlPrefix}
        teams={teams}
      />
    </div>
  );
}
