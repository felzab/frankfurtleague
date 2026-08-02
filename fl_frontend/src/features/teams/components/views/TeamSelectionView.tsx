import { PAGE_RISE } from "@/shared/components/ui/motion";

import { TeamsGrid } from "../collections/TeamsGrid";

import type { FLTeam } from "../../schemas";

export function TeamSelectionView({
  title,
  description,
  urlPrefix,
  teams,
}: {
  title: string;
  description: string;
  urlPrefix: string;
  teams: FLTeam[];
}) {
  return (
    /* Backs BOTH /dashboard/teams and /dashboard/spieler, which is why its having no entrance was
       two routes short of the rest of the nav rather than one. The rise carries the title block; the
       grid inside cascades on its own, the same split `SpielplanView` uses. */
    <div className={`${PAGE_RISE} relative flex w-full flex-1 flex-col items-center`}>
      <div className="max-w-page mb-8 flex w-full flex-col gap-y-2">
        <h1 className="fluid-xl text-foreground font-extrabold tracking-tight">{title}</h1>
        <p className="fluid-sm text-foreground-muted max-w-2xl font-medium whitespace-normal">{description}</p>
      </div>

      <TeamsGrid
        urlPrefix={urlPrefix}
        teams={teams}
      />
    </div>
  );
}
