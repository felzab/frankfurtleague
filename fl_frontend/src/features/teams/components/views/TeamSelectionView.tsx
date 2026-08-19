import { PAGE_RISE } from "@/shared/components/ui/motion";

import { TeamsGrid } from "../collections/TeamsGrid";

import type { FLTeam } from "../../schemas";

export function TeamSelectionView({ urlPrefix, teams }: { urlPrefix: string; teams: FLTeam[] }) {
  return (
    /* The rise brings in what the cascade cannot: `TeamsGrid`'s empty state, which stands in for
       the whole collection when a season has no teams. */
    <div className={`${PAGE_RISE} relative flex w-full flex-1 flex-col items-center pt-6`}>
      <TeamsGrid
        urlPrefix={urlPrefix}
        teams={teams}
      />
    </div>
  );
}
