import { Card, Chip } from "@heroui/react";

import type { FLTeamCompact } from "../schemas";

export default function TeamCard({ teamData }: { teamData: FLTeamCompact }) {
  return (
    <Card
      variant="default"
      className="flex size-full flex-col items-start border-1 text-left shadow-lg transition-all hover:scale-[1.02] hover:border-emerald-500/50 hover:shadow-xl">
      <Card.Header className="flex h-fit w-full flex-row items-center justify-between pb-4">
        <div>
          <Card.Title className="text-fluid-base font-bold">{teamData.name}</Card.Title>
          <Card.Description className="text-fluid-xxs font-medium">{teamData.address.stadtteil}</Card.Description>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
          {teamData.shorthand}
        </div>
      </Card.Header>
      <Card.Content className="mt-4 pt-0">
        <div className="flex flex-row items-center gap-x-2">
          <Chip
            size="sm"
            variant="soft"
            color="success">
            {teamData.statistik.punkte} Punkte
          </Chip>
          <Chip
            size="sm"
            variant="soft"
            color="success">
            {teamData.statistik.siege} Siege
          </Chip>
          <Chip
            size="sm"
            variant="soft"
            color="success">
            {teamData.statistik.tore_geschossen} Tore
          </Chip>
        </div>
      </Card.Content>
    </Card>
  );
}
