import { Calendar, Chip } from "@heroui/react";
import type { SpielStatus } from "../../types";
import { CircleCheckFill, CircleQuestion, Clock, XmarkShapeFill } from "@gravity-ui/icons";

export default function SpielStatusChip({ spielStatus }: { spielStatus: SpielStatus }) {
  const colorMap = {
    vergangen: "success",
    heute: "default",
    ausstehend: "accent",
    unbekannt: "warning",
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
      className="w-fit text-fluid-xxs! font-extrabold tracking-wide py-0.5 px-1.5 lg:px-2 text-text-black">
      {iconMap[spielStatus]}
      {spielStatus.toUpperCase()}
    </Chip>
  );
}
