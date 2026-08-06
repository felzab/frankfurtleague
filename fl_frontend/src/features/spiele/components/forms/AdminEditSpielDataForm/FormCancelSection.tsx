import { Switch } from "@heroui/react";

import { FORM_SECTION_HEADING, FORM_SECTION_PANEL } from "@/shared/components/ui/formFieldStyles";

/**
 * Whether the fixture was called off.
 *
 * **Its own panel, at the end, and that placement is the point.** `is_canceled` is the one control on
 * this form that describes the fixture rather than its data, and it was previously the first thing above
 * the fields — so the destructive answer sat where the eye lands first. It carries no validation because
 * a boolean has nothing to reject.
 *
 * **A cancelled match is not a match with no result.** The flag and the `ergebnis` are independent: a
 * fixture awarded without being played carries both, and that is what makes it count in the league table
 * (ADR-0026). Nothing here clears the result, and the hint says so in one line — the reversibility of a
 * switch is not something a hint has to explain (ADR-0050).
 */
export function FormCancelSection({
  spielIsCanceled,
  onSpielIsCanceledChange,
}: {
  spielIsCanceled: boolean;
  onSpielIsCanceledChange: (value: boolean) => void;
}) {
  return (
    <div className={FORM_SECTION_PANEL}>
      <h2 className={FORM_SECTION_HEADING}>Absage</h2>

      {/* No `aria-label`: "Spiel absagen" below sits inside the switch's own <label>, so an
          aria-label would only override the visible text with a copy of itself. */}
      <div className="flex w-full flex-col gap-y-1.5">
        <Switch
          size="md"
          aria-describedby="spiel-absagen-hint"
          isSelected={spielIsCanceled}
          onChange={onSpielIsCanceledChange}>
          <Switch.Content className="fluid-sm text-danger flex h-fit w-fit flex-row items-center gap-x-3 font-bold">
            Spiel absagen
            <Switch.Control className={`${spielIsCanceled ? "bg-danger" : ""}`}>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>
        {/* Outside the `Switch`, which renders a `<label>`: as a child, this whole paragraph
            toggled the switch on any click. `aria-describedby` keeps the screen-reader wiring that
            `Description` provided. */}
        <p
          id="spiel-absagen-hint"
          className="fluid-xxs text-foreground-muted leading-normal font-medium">
          Ein eingetragenes Ergebnis bleibt stehen und zählt weiter.
        </p>
      </div>
    </div>
  );
}
