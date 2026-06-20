import type { FLTeamCompact } from "../../schemas";
import TeamsGrid from "../collections/TeamsGrid";

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
      <div className="flex flex-col mb-8 gap-y-2 p-2">
        <h3 className="text-fluid-lg lg:text-fluid-xl font-extrabold tracking-tight">{title}</h3>
        <p className="text-fluid-xs whitespace-normal w-[80%]">{description}</p>
      </div>

      <TeamsGrid
        urlPrefix={urlPrefix}
        teams={teams}
      />
    </>
  );
}
