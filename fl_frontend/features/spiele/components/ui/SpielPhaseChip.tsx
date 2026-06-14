import { Chip } from "@heroui/react";
import type { SpielPhase } from "../../types";

export default function SpielPhaseChip({ spielPhase }: { spielPhase: SpielPhase }) {
  const colorMap = {
    gruppenphase: "warning",
    viertelfinale: "danger",
    halbfinale: "accent",
    finale: "success",
  } as const;

  const iconMap = {
    gruppenphase: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="1.25em"
        height="1.25em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round">
        <rect
          x="4"
          y="4"
          width="6"
          height="6"
          rx="1"
        />
        <rect
          x="14"
          y="4"
          width="6"
          height="6"
          rx="1"
        />
        <rect
          x="4"
          y="14"
          width="6"
          height="6"
          rx="1"
        />
        <rect
          x="14"
          y="14"
          width="6"
          height="6"
          rx="1"
        />
      </svg>
    ),
    viertelfinale: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="1.25em"
        height="1.25em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round">
        <path d="M4 4h4v5H4" />
        <path d="M8 6.5h4" />
        <path d="M4 15h4v5H4" />
        <path d="M8 17.5h4" />
        <path d="M12 6.5v11" />
        <path d="M12 12h6" />
      </svg>
    ),
    halbfinale: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="1.25em"
        height="1.25em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round">
        <path d="M6 6h5v12H6" />
        <path d="M11 12h7" />
        <circle
          cx="19"
          cy="12"
          r="2"
        />
      </svg>
    ),
    finale: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="1.25em"
        height="1.25em"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round">
        <path d="M8 21h8" />
        <path d="M12 17v4" />
        <path d="M7 4h10l-1 9c0 3-4 4-4 4s-4-1-4-4L7 4z" />
        <path d="M7 7H5a2 2 0 0 1 0-4h2" />
        <path d="M17 7h2a2 2 0 0 0 0-4h-2" />
      </svg>
    ),
  } as const;

  return (
    <Chip
      size="sm"
      variant="primary"
      color={colorMap[spielPhase]}
      className="w-fit text-fluid-xxs! font-extrabold tracking-wide py-0.5 px-1.5 lg:px-2 text-text-black brightness-95">
      {iconMap[spielPhase]}
      {spielPhase.toUpperCase()}
    </Chip>
  );
}
