import { Chip } from "@heroui/react";
import type { SpielStatus } from "../../types";

export default function SpielStatusChip({ spielStatus }: { spielStatus: SpielStatus }) {
  const colorMap = {
    vergangen: "success",
    heute: "default",
    ausstehend: "accent",
    unbekannt: "warning",
    abgesagt: "danger",
  } as const;

  return (
    <Chip
      size="sm"
      variant="primary"
      color={colorMap[spielStatus]}
      className="w-fit text-fluid-xxs! font-extrabold tracking-wide py-0.5 lg:py-1 px-1.5 lg:px-2 text-text-black">
      {spielStatus.toUpperCase()}
    </Chip>
  );
}
