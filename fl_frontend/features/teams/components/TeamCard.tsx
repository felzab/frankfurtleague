import { Card, Chip } from "@heroui/react";
import type { FLTeamCompact } from "../types";

export default function TeamCard({ teamData }: { teamData: FLTeamCompact }) {
  return (
    <Card
      variant="default"
      className="flex flex-col items-start size-full border-1 hover:border-emerald-500/50 transition-all hover:scale-[1.02] shadow-lg hover:shadow-xl text-left">
      <Card.Header className="flex flex-row items-center justify-between w-full h-fit pb-4">
        <div>
          <Card.Title className="text-fluid-base font-bold">{teamData.name}</Card.Title>
          <Card.Description className="text-fluid-xxs font-medium">{teamData.address.stadtteil}</Card.Description>
        </div>
        <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-emerald-700 dark:text-emerald-400 font-bold shrink-0">
          {teamData.shorthand}
        </div>
      </Card.Header>
      <Card.Content className="pt-0 mt-4">
        <div className="flex flex-row gap-x-2 items-center">
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
