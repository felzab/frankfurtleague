import { Callout } from "@/shared/components/ui/Callout";

import type { FLSpiel } from "@/features/spiele/schemas";

/**
 * The note a fixture carries when saving it can clear a result somebody entered elsewhere (ADR-0048).
 *
 * Applying a bracket advancement writes the affected fixture's sides with their goals stripped and sets
 * `ergebnis` and `elfmeterschiessen` to `None` (`fl_backend/app/api/spiele/crud.py ::
 * advance_bracket_winners`). That is correct — goals scored by a team no longer in the fixture are not
 * that fixture's result — and until this note existed nothing said so before the write.
 *
 * **It names the fixtures wired to this one and then says "and the fixtures below them".** Naming only
 * the direct dependents would read as the complete list, and it is not: the resolution cascades, so a
 * fixture two rounds down can lose its result through one that is named here.
 *
 * **Standing, so not announced.** Nothing has happened — this is a property of the fixture, present from
 * first paint on every wired one, and `role="alert"` would report it as an event on every re-render.
 *
 * **Two short lines, and the fixture numbers do the work.** A warning long enough to need reading is a
 * warning that gets skipped (ADR-0050).
 */
export function FormVoidWarning({ dependentSpiele }: { dependentSpiele: readonly FLSpiel[] }) {
  if (dependentSpiele.length === 0) return null;

  // German puts "und" before the last item with no serial comma, and the runtime already knows that —
  // the same reason `formatSpielUpdateMessage` uses it.
  const spielNummern = new Intl.ListFormat("de-DE", { style: "long", type: "conjunction" }).format(
    dependentSpiele.map((spiel) => String(spiel.spiel_nr)),
  );

  return (
    <Callout
      severity="warning"
      title={
        dependentSpiele.length === 1
          ? `Spiel ${spielNummern} ist von diesem Spiel abhängig`
          : `Die Spiele ${spielNummern} sind von diesem Spiel abhängig`
      }>
      Speichern kann dort und in den Spielen darunter ein eingetragenes Ergebnis löschen.
    </Callout>
  );
}
