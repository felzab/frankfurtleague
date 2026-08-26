import { Calendar, CircleCheckFill, CircleQuestion, Clock, XmarkShapeFill } from "@gravity-ui/icons";

import { Chip } from "@heroui/react";

import { PILL_RADIUS } from "@/shared/components/ui/badges";

import type { FLSpielStatus } from "../../schemas";

// Module scope so they do not rebuild per render, and `Record<FLSpielStatus,...>` so a backend
// enum change is a compile error rather than a raw API value in the UI.
const STATUS_CLASSES: Record<FLSpielStatus, string> = {
  vergangen: "bg-success/15 text-success-strong",
  heute: "bg-info/15 text-info-strong",
  ausstehend: "bg-warning/15 text-warning-strong",
  unbekannt: "bg-muted text-foreground-muted",
  abgesagt: "bg-danger/15 text-danger-strong",
};

const STATUS_ICONS: Record<FLSpielStatus, React.ReactElement> = {
  vergangen: <CircleCheckFill className="size-3.5" />,
  heute: <Calendar className="size-3.5" />,
  ausstehend: <Clock className="size-3.5" />,
  unbekannt: <CircleQuestion className="size-3.5" />,
  abgesagt: <XmarkShapeFill className="size-3.5" />,
};

// One word per status, shared with `fl_frontend/src/features/spiele/facets.ts :: buildSpielFacets`:
// two spellings of one state read as two. Not the schema value either, which would couple the
// visible German to the API contract.
const STATUS_LABELS: Record<FLSpielStatus, string> = {
  vergangen: "Vergangen",
  heute: "Heute",
  ausstehend: "Ausstehend",
  unbekannt: "Ohne Datum",
  abgesagt: "Abgesagt",
};

export function SpielStatusChip({ spielStatus }: { spielStatus: FLSpielStatus }) {
  return (
    <Chip
      size="sm"
      className={`${PILL_RADIUS} border-none px-1.5 py-0.5 ${STATUS_CLASSES[spielStatus]}`}>
      <div className="fluid-xxs flex items-center gap-1 font-extrabold tracking-wide uppercase">
        {STATUS_ICONS[spielStatus]}
        {STATUS_LABELS[spielStatus]}
      </div>
    </Chip>
  );
}
