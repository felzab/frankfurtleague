import { Card, Chip } from "@heroui/react";

import { PILL_RADIUS } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";

import type { FLTeam } from "../../schemas";

/**
 * The three stat chips take their colour from THIS app's palette via `className`, not from HeroUI's
 * `color`/`variant` props — the same way `SpielStatusChip` and `SaisonPhaseChip` already do.
 *
 * **Never `variant`/`color` on a Chip here.** Those props resolve against HeroUI's own theme tokens
 * (`--success-soft` and friends), and **this app maps none of them**: `globals.css` overrides exactly
 * one HeroUI raw token, `--focus`, and declares everything else in the `--accent-*` / `--color-*`
 * namespaces HeroUI's components never read. A chip set that way renders in HeroUI's stock palette —
 * a different green from every other chip in the app, or a stock blue.
 *
 * The `-strong` companion for the label, the plain accent at 15% for the tint: the rule is stated
 * once beside the tokens in `globals.css`, and it is what keeps small text on a tint above 4.5:1.
 * HeroUI's `--success-soft-foreground` is a `color-mix` against ITS foreground token and has never
 * been measured against this app's surfaces.
 */
const STAT_CHIP_CLASSES = `${PILL_RADIUS} bg-success/15 text-success-strong`;

/** `value` rather than a precomputed number so the three rows stay one declaration each. */
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
        <div className="bg-brand/50 text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-extrabold shadow-sm">
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
