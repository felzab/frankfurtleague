"use client";

import Link from "next/link";

import TeamCard from "../TeamCard";

import type { FLTeamCompact } from "../../schemas";

export default function TeamsGrid({ teams, urlPrefix }: { teams: FLTeamCompact[]; urlPrefix: string }) {
  return (
    <div className="grid w-full max-w-[1400px] grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {teams.map((teamData) => (
        <Link
          key={teamData.id}
          href={`${urlPrefix}/${teamData.id}`}
          className="focus-visible:ring-brand size-full rounded-xl outline-none focus-visible:ring-1">
          <TeamCard teamData={teamData} />
        </Link>
      ))}
    </div>
  );
}
