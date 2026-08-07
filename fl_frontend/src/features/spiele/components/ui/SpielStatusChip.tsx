import { Calendar, CircleCheckFill, CircleQuestion, Clock, XmarkShapeFill } from "@gravity-ui/icons";

import { Chip } from "@heroui/react";

import type { FLSpielStatus } from "../../schemas";

// All three maps are module-invariant: they close over nothing and depend on no prop. Built inside
// the component they were rebuilt on every render -- ~80 cards per spielplan page render two chips
// each -- to read one entry and discard the rest. Sharing one element instance across renders is
// safe: React elements are immutable descriptors, not mounted instances.
//
// Record<FLSpielStatus, ...> is what makes them exhaustive, so a backend enum change is a compile
// error here rather than a raw API value appearing in the UI.
// Tint from the feedback accent, label from its `-strong` companion. The plain accent is a fill
// colour: as small bold text on its own 15% tint it measures 2.58:1 (success) and 1.61:1 (warning)
// in the light theme. `-strong` restores 5.96-8.51:1.
//
// Every status clears AA in both themes. The values live in globals.css; this file only names them,
// so a contrast question about a chip is answered there, not here.
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
      /* `rounded-md` overrides HeroUI's `rounded-2xl` on `.chip` (owner, 2026-08-07). One radius for
         every pill in the app: this chip, `SaisonPhaseChip` beside it, and the `LABEL_BADGE` /
         `COUNT_BADGE` recipes the admin surfaces are built from. A utility beats the component layer,
         so no `!` is needed. */
      className={`rounded-md border-none px-1.5 py-0.5 ${STATUS_CLASSES[spielStatus]}`}>
      <div className="fluid-xxs flex items-center gap-1 font-extrabold tracking-wide uppercase">
        {STATUS_ICONS[spielStatus]}
        {STATUS_LABELS[spielStatus]}
      </div>
    </Chip>
  );
}
