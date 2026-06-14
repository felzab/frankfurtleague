import { Chip } from "@heroui/react";
import { CircleCheckFill, CircleQuestion, Clock, XmarkShapeFill, Calendar } from "@gravity-ui/icons";
import type { FLSpielStatus } from "../../types";

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
      className="w-fit text-fluid-xxs! font-extrabold tracking-wide py-0.5 px-1.5 lg:px-2 text-text-black brightness-95">
      {iconMap[spielStatus]}
      {spielStatus.toUpperCase()}
    </Chip>
  );
}
