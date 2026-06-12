"use client";

import { Button, Card, Chip } from "@heroui/react";
import type { FLTeam } from "../types";
export default function TeamsGrid({ teams, onSelect }: { teams: FLTeam[]; onSelect: (id: string) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {teams.map((teamData) => (
        <Button
          key={teamData.id}
          onClick={() => onSelect(teamData.id)}
          className="block w-full h-auto text-left group transition-transform hover:scale-[1.02] px-0">
          <Card
            variant="default"
            className="flex flex-col items-start size-full border-1 group-hover:border-emerald-500/50 transition-colors shadow-lg group-hover:shadow-xl">
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
        </Button>
      ))}
    </div>
  );
}
