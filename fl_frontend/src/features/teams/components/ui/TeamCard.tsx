import { Card, Chip } from "@heroui/react";

import { PILL_RADIUS } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";

import type { FLTeam } from "../../schemas";

/**
 * **Never `variant`/`color` on a Chip here**: those resolve against HeroUI's own theme tokens, which
 * this app maps none of, so the chip renders in HeroUI's stock palette rather than this one's.
 */
const STAT_CHIP_CLASSES = `${PILL_RADIUS} bg-success/15 text-success-strong`;

/** `value` rather than a precomputed number, so each row stays one declaration. */
const STAT_CHIPS: { label: string; value: (team: FLTeam) => number }[] = [
  { label: "Punkte", value: (team) => team.statistik.punkte },
  { label: "Siege", value: (team) => team.statistik.siege },
  { label: "Tore", value: (team) => team.statistik.tore_geschossen },
];

export function TeamCard({ teamData }: { teamData: FLTeam }) {
  return (
    <Card
      variant="default"
      className={`${card({ interactive: true })} flex size-full flex-col items-start p-4`}>
      <Card.Header className="flex h-fit w-full flex-row items-center justify-between pb-3">
        <div>
          <Card.Title className="fluid-base font-bold">{teamData.name}</Card.Title>
          <Card.Description className="fluid-xxs text-foreground-muted font-medium">{teamData.address.stadtteil}</Card.Description>
        </div>
        <div className="bg-brand-solid text-brand-solid-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-extrabold shadow-sm">
          {teamData.shorthand}
        </div>
      </Card.Header>

      <Card.Content className="mt-2 p-0">
        <div className="flex flex-row items-center gap-x-2">
          {STAT_CHIPS.map(({ label, value }) => (
            <Chip
              key={label}
              size="sm"
              className={STAT_CHIP_CLASSES}>
              {value(teamData)} {label}
            </Chip>
          ))}
        </div>
      </Card.Content>
    </Card>
  );
}
