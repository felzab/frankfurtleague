import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";

import { TeamsGrid } from "../collections/TeamsGrid";

import type { FLTeam } from "../../schemas";

export function TeamSelectionView({
  urlPrefix,
  teams,
  saisonId,
  isFinishedSaison,
}: {
  urlPrefix: string;
  teams: FLTeam[];
  saisonId: string | undefined;
  isFinishedSaison: boolean;
}) {
  return (
    /* The rise brings in what the cascade cannot: `TeamsGrid`'s empty state, which stands in for
       the whole collection when a season has no teams. */
    <div className={`${PAGE_RISE_CLASSES} relative flex w-full flex-1 flex-col items-center pt-6`}>
      <TeamsGrid
        urlPrefix={urlPrefix}
        teams={teams}
        saisonId={saisonId}
        isFinishedSaison={isFinishedSaison}
      />
    </div>
  );
}
