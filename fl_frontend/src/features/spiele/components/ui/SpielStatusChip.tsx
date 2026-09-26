import Calendar from "@gravity-ui/icons/Calendar";
import CircleCheckFill from "@gravity-ui/icons/CircleCheckFill";
import CircleQuestion from "@gravity-ui/icons/CircleQuestion";
import Clock from "@gravity-ui/icons/Clock";
import XmarkShapeFill from "@gravity-ui/icons/XmarkShapeFill";

import { Chip } from "@heroui/react/chip";

import { PILL_RADIUS_CLASSES, PILL_TINT_CLASSES } from "@/shared/components/ui/badges";

import type { PillTone } from "@/shared/components/ui/badges";
import type { FLSpielStatus } from "../../schemas";

// Module scope so they do not rebuild per render, and `Record<FLSpielStatus,...>` so a backend
// enum change is a compile error rather than a raw API value in the UI.
const STATUS_TINT: Record<FLSpielStatus, PillTone> = {
  vergangen: "success",
  heute: "info",
  ausstehend: "warning",
  // An undated fixture is a state to leave, as a season with no Spielplan is, and not a kind of
  // fixture: the season cannot be played until somebody dates it.
  unbekannt: "warning",
  abgesagt: "danger",
};

const STATUS_ICONS: Record<FLSpielStatus, React.ReactElement> = {
  vergangen: (
    <CircleCheckFill
      aria-hidden="true"
      className="size-3.5"
    />
  ),
  heute: (
    <Calendar
      aria-hidden="true"
      className="size-3.5"
    />
  ),
  ausstehend: (
    <Clock
      aria-hidden="true"
      className="size-3.5"
    />
  ),
  unbekannt: (
    <CircleQuestion
      aria-hidden="true"
      className="size-3.5"
    />
  ),
  abgesagt: (
    <XmarkShapeFill
      aria-hidden="true"
      className="size-3.5"
    />
  ),
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
      className={`${PILL_RADIUS_CLASSES} border-none px-1.5 py-0.5 ${PILL_TINT_CLASSES[STATUS_TINT[spielStatus]]}`}>
      <div className="flex items-center gap-1 fluid-xxs font-extrabold tracking-wide uppercase">
        {STATUS_ICONS[spielStatus]}
        {STATUS_LABELS[spielStatus]}
      </div>
    </Chip>
  );
}
