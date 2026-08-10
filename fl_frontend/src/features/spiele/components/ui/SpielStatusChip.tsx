import { Calendar, CircleCheckFill, CircleQuestion, Clock, XmarkShapeFill } from "@gravity-ui/icons";

import { Chip } from "@heroui/react";

import type { FLSpielStatus } from "../../schemas";

// Module scope, and `Record<FLSpielStatus,...>` so they stay exhaustive: in the
// component these rebuild per render, and a backend enum change becomes a compile
// error rather than a raw API value in the UI. Contrast is `globals.css`'s.
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

// The label is deliberately not the schema value: rendering `spielStatus` directly coupled the
// user-visible German to the API contract. "Datum offen" also says what `unbekannt` means -- the
// date is not set yet, rather than something being wrong.
const STATUS_LABELS: Record<FLSpielStatus, string> = {
  vergangen: "Beendet",
  heute: "Heute",
  ausstehend: "Ausstehend",
  unbekannt: "Datum offen",
  abgesagt: "Abgesagt",
};

export function SpielStatusChip({ spielStatus }: { spielStatus: FLSpielStatus }) {
  return (
    <Chip
      size="sm"
      /* `rounded-md` overrides HeroUI's `rounded-2xl` on `.chip`: one radius for every pill in the
         app, this chip and the badge recipes alike. A utility beats the component layer, so no `!`
         is needed. */
      className={`rounded-md border-none px-1.5 py-0.5 ${STATUS_CLASSES[spielStatus]}`}>
      <div className="fluid-xxs flex items-center gap-1 font-extrabold tracking-wide uppercase">
        {STATUS_ICONS[spielStatus]}
        {STATUS_LABELS[spielStatus]}
      </div>
    </Chip>
  );
}
