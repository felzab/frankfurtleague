import { Calendar, CircleCheckFill, CircleQuestion, Clock, XmarkShapeFill } from "@gravity-ui/icons";

import { Chip } from "@heroui/react";

import type { FLSpielStatus } from "../../schemas";

export default function SpielStatusChip({ spielStatus }: { spielStatus: FLSpielStatus }) {
  const tailwindColors = {
    vergangen: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    heute: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
    ausstehend: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    unbekannt: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
    abgesagt: "bg-red-500/15 text-red-700 dark:text-red-400",
  } as const;

  const iconMap = {
    vergangen: <CircleCheckFill className="size-3.5" />,
    heute: <Calendar className="size-3.5" />,
    ausstehend: <Clock className="size-3.5" />,
    unbekannt: <CircleQuestion className="size-3.5" />,
    abgesagt: <XmarkShapeFill className="size-3.5" />,
  } as const;

  return (
    <Chip
      size="sm"
      className={`border-none px-1.5 py-0.5 ${tailwindColors[spielStatus]}`}>
      <div className="text-fluid-xxs flex items-center gap-1 font-extrabold tracking-wide uppercase">
        {iconMap[spielStatus]}
        {spielStatus}
      </div>
    </Chip>
  );
}
