import { Chip } from "@heroui/react";
import type { SpielPhase } from "../../types";

export default function SpielPhaseChip({ spielPhase }: { spielPhase: SpielPhase }) {
  const colorMap = {
    gruppenphase: "warning",
    viertelfinale: "danger",
    halbfinale: "accent",
    finale: "success",
  } as const;

  return (
    <Chip
      size="sm"
      variant="primary"
      color={colorMap[spielPhase]}
      className="w-fit text-fluid-xxs! font-extrabold tracking-wide py-0.5 lg:py-1 px-1.5 lg:px-2 text-text-black">
      {spielPhase.toUpperCase()}
    </Chip>
  );
}
