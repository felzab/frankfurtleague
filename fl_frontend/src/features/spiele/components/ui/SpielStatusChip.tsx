import { Calendar, CircleCheckFill, CircleQuestion, Clock, XmarkShapeFill } from "@gravity-ui/icons";

import { Chip } from "@heroui/react";

import type { FLSpielStatus } from "../../schemas";

export default function SpielStatusChip({ spielStatus }: { spielStatus: FLSpielStatus }) {
  const colorMap = {
    vergangen: "success",
    heute: "accent",
    ausstehend: "warning",
    unbekannt: "accent",
    abgesagt: "danger",
  } as const;

  const iconMap = {
    vergangen: <CircleCheckFill />,
    heute: <Calendar />,
    ausstehend: <Clock />,
    unbekannt: <CircleQuestion />,
    abgesagt: <XmarkShapeFill />,
  } as const;

  return (
    <Chip
      size="sm"
      variant="primary"
      color={colorMap[spielStatus]}
      className="text-fluid-xxs! text-text-black w-fit px-1.5 py-0.5 font-extrabold tracking-wide brightness-95 lg:px-2">
      {iconMap[spielStatus]}
      {spielStatus.toUpperCase()}
    </Chip>
  );
}
