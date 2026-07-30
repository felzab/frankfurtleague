import TeamsGrid from "../collections/TeamsGrid";

import type { FLTeamCompact } from "../../schemas";

export function TeamSelectionView({
  title,
  description,
  urlPrefix,
  teams,
}: {
  title: string;
  description: string;
  urlPrefix: string;
  teams: FLTeamCompact[];
}) {
  return (
    <div className="relative flex w-full flex-1 flex-col items-center">
      <div className="max-w-page mb-8 flex w-full flex-col gap-y-2">
        <h3 className="text-fluid-xl text-foreground font-extrabold tracking-tight">{title}</h3>
        <p className="text-fluid-sm text-foreground-muted max-w-2xl font-medium whitespace-normal">{description}</p>
      </div>

      <TeamsGrid
        urlPrefix={urlPrefix}
        teams={teams}
      />
    </div>
  );
}
