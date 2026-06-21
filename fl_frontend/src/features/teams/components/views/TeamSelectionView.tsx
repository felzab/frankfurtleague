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
    <>
      <div className="mb-8 flex flex-col gap-y-2 p-2">
        <h3 className="text-fluid-lg lg:text-fluid-xl font-extrabold tracking-tight">{title}</h3>
        <p className="text-fluid-xs w-[80%] whitespace-normal">{description}</p>
      </div>

      <TeamsGrid
        urlPrefix={urlPrefix}
        teams={teams}
      />
    </>
  );
}
