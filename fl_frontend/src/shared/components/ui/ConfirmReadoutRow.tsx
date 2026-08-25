/**
 * One label-and-value row of an armed control's readout. **A `<dl>` is its only valid parent**: the
 * pair is what makes the value a fact about the label rather than two strings sharing a line.
 */
export function ConfirmReadoutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-row items-baseline justify-between gap-x-3">
      <dt className="fluid-xxs text-foreground-muted font-bold">{label}</dt>
      <dd className="fluid-xs text-foreground min-w-0 text-right font-semibold">{value}</dd>
    </div>
  );
}
