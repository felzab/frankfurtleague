import { Card, Chip } from "@heroui/react";

import type { FLTeamCompact } from "../schemas";

export default function TeamCard({ teamData }: { teamData: FLTeamCompact }) {
  return (
    <Card
      variant="default"
      className="bg-surface border-border text-foreground hover:border-brand hover:scale-hover flex size-full flex-col items-start rounded-xl border p-4 shadow-sm transition-all">
      <Card.Header className="flex h-fit w-full flex-row items-center justify-between pb-3">
        <div>
          <Card.Title className="text-fluid-base font-bold">{teamData.name}</Card.Title>
          <Card.Description className="text-fluid-xxs text-foreground-muted font-medium">{teamData.address.stadtteil}</Card.Description>
        </div>
        <div className="bg-brand/50 text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-extrabold shadow-sm">
          {teamData.shorthand}
        </div>
      </Card.Header>

      <Card.Content className="mt-2 p-0">
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
