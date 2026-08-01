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
// in the light theme. `-strong` restores 4.29-5.02:1, i.e. the contrast this chip had before it was
// tokenised.
//
// `vergangen` (4.29:1) and `ausstehend` (4.22:1) remain just under AA in the LIGHT theme only; dark
// measures 6.10-8.51. Accepted by the owner 2026-07-31 (ledger NEW-C1): both sit at or above their
// pre-audit values, the labels carry an icon beside them, and passing 4.5:1 on amber needs roughly
// amber-800, which reads brown. This is a recorded deviation, not an oversight -- do not "fix" it
// by darkening the tokens without the owner.
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
      className={`border-none px-1.5 py-0.5 ${STATUS_CLASSES[spielStatus]}`}>
      <div className="text-fluid-xxs flex items-center gap-1 font-extrabold tracking-wide uppercase">
        {STATUS_ICONS[spielStatus]}
        {STATUS_LABELS[spielStatus]}
      </div>
    </Chip>
  );
}
