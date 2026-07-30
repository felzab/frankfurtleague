"use client";

import Link from "next/link";

import { EmptyState } from "@/shared/components/ui/EmptyState";

import TeamCard from "../TeamCard";

import type { FLTeamCompact } from "../../schemas";

export default function TeamsGrid({ teams, urlPrefix }: { teams: FLTeamCompact[]; urlPrefix: string }) {
  // Season-scoped: an empty list usually means this season has no teams yet, not that none exist
  // anywhere -- selecting a future season in the SaisonSelector produces exactly that (R4 §12.5).
  if (teams.length === 0) {
    return (
      <EmptyState
        title="Für diese Saison sind noch keine Teams eingetragen."
        hint="Sobald Teams gemeldet sind, erscheinen sie hier."
      />
    );
  }

  return (
    <div className="max-w-page grid w-full grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
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
