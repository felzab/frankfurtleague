import Calendar from "@gravity-ui/icons/Calendar";
import CircleCheckFill from "@gravity-ui/icons/CircleCheckFill";
import CircleDashed from "@gravity-ui/icons/CircleDashed";
import CircleQuestion from "@gravity-ui/icons/CircleQuestion";
import Clock from "@gravity-ui/icons/Clock";
import XmarkShapeFill from "@gravity-ui/icons/XmarkShapeFill";

import { Chip } from "@heroui/react/chip";

import { PILL_RADIUS_CLASSES, PILL_TINT_CLASSES } from "@/shared/components/ui/badges";

import { SPIEL_STATUS_LABELS } from "../../constants";

import type { PillTone } from "@/shared/components/ui/badges";
import type { FLSpielStatus } from "../../schemas";

// The chip's own vocabulary and never a member of `FLSpielStatus`, the backend's filter enum: no
// reader filters fixtures by a confirmation.
type SpielChipStatus = FLSpielStatus | "vorlaeufig";

// Module scope so they do not rebuild per render, and `Record<SpielChipStatus,...>` so a backend
// enum change is a compile error rather than a raw API value in the UI.
const STATUS_TINT: Record<SpielChipStatus, PillTone> = {
  vergangen: "success",
  heute: "info",
  ausstehend: "warning",
  // The tone of `ausstehend`, the one state it replaces: no tone is neutral (`docs/frontend/spec.md :: I170`).
  vorlaeufig: "warning",
  // An undated fixture is a state to leave, as a season with no Spielplan is, and not a kind of
  // fixture: the season cannot be played until somebody dates it.
  unbekannt: "warning",
  abgesagt: "danger",
};

const STATUS_ICONS: Record<SpielChipStatus, React.ReactElement> = {
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
  vorlaeufig: (
    <CircleDashed
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

// The status filter's words, so a state never reads under two spellings; „Vorläufig“ alone is the chip's.
const STATUS_LABELS: Record<SpielChipStatus, string> = { ...SPIEL_STATUS_LABELS, vorlaeufig: "Vorläufig" };

/**
 * `ansetzungBestaetigt` is required so that every mount decides what it passes: `null` where nobody was asked,
 * and wherever the Ansetzung shown is not the stored one the verdict is about.
 */
export function SpielStatusChip({ spielStatus, ansetzungBestaetigt }: { spielStatus: FLSpielStatus; ansetzungBestaetigt: boolean | null }) {
  // The scheduling state wins from match day on: a row minted last week is still open on the day
  // (`docs/frontend/spec.md :: I764`).
  const chipStatus: SpielChipStatus = spielStatus === "ausstehend" && ansetzungBestaetigt === false ? "vorlaeufig" : spielStatus;

  return (
    <Chip
      size="sm"
      className={`${PILL_RADIUS_CLASSES} border-none px-1.5 py-0.5 ${PILL_TINT_CLASSES[STATUS_TINT[chipStatus]]}`}>
      <div className="flex items-center gap-1 fluid-xxs font-extrabold tracking-wide uppercase">
        {STATUS_ICONS[chipStatus]}
        {STATUS_LABELS[chipStatus]}
      </div>
    </Chip>
  );
}
