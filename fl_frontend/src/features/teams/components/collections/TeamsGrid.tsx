"use client";

import Link from "next/link";

import TeamCard from "../TeamCard";

import type { FLTeamCompact } from "../../schemas";

export default function TeamsGrid({ teams, urlPrefix }: { teams: FLTeamCompact[]; urlPrefix: string }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {teams.map((teamData) => (
        <Link
          key={teamData.id}
          href={`${urlPrefix}/${teamData.id}`}
          className="rounded-large block h-full w-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-500">
          <TeamCard teamData={teamData} />
        </Link>
      ))}
    </div>
  );
}
