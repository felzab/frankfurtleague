import { TriangleExclamation } from "@gravity-ui/icons";

import type { FLSpiel } from "@/features/spiele/schemas";

/**
 * The note a fixture carries when saving it can clear a result somebody entered elsewhere (ADR-0048).
 *
 * Applying a bracket advancement writes the affected fixture's sides with their goals stripped and sets
 * `ergebnis` and `elfmeterschiessen` to `None` (`fl_backend/app/api/spiele/crud.py ::
 * advance_bracket_winners`). That is correct — goals scored by a team no longer in the fixture are not
 * that fixture's result — and until this note existed nothing said so before the write.
 *
 * **Static, and deliberately imprecise.** It fires whenever stored wiring makes another fixture depend on
 * this one, whether or not this particular save would actually void anything. Predicting which results
 * would go means running the resolution against the payload before accepting it, which ADR-0048 rejects:
 * a prediction that is right most of the time teaches an operator to trust it on the occasion it is
 * wrong. So the wording states the mechanism — that results *can* be cleared — and never that they will
 * be.
 *
 * **It names the fixtures wired to this one and then says "and the fixtures below them".** Naming only
 * the direct dependents would read as the complete list, and it is not: the resolution cascades, so a
 * fixture two rounds down can lose its result through one that is named here.
 *
 * Not `role="alert"`: nothing has happened yet. It is a standing property of this fixture, present from
 * first paint, and an alert role would announce it as an event every time the section re-renders.
 *
 * **Two short lines, and the fixture numbers do the work.** A warning long enough to need reading is a
 * warning that gets skipped, and this one is on screen from first paint on every wired fixture rather
 * than at the moment of danger (ADR-0050).
 */
export function FormVoidWarning({ dependentSpiele }: { dependentSpiele: readonly FLSpiel[] }) {
  if (dependentSpiele.length === 0) return null;

  // German puts "und" before the last item with no serial comma, and the runtime already knows that —
  // the same reason `formatSpielUpdateMessage` uses it.
  const spielNummern = new Intl.ListFormat("de-DE", { style: "long", type: "conjunction" }).format(
    dependentSpiele.map((spiel) => String(spiel.spiel_nr)),
  );

  // `/15` and `-strong`, not the plain accent: that is the tint the `--accent-*-strong` values in
  // `globals.css` were measured against, and `text-warning` on it measures 1.61:1.
  return (
    <div className="border-warning/40 bg-warning/15 flex w-full flex-row items-start gap-x-3 rounded-xl border p-3">
      <TriangleExclamation className="text-warning-strong mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-y-1">
        <strong className="fluid-xs text-warning-strong font-bold">
          {dependentSpiele.length === 1 ? `Spiel ${spielNummern} hängt an diesem Spiel` : `Spiele ${spielNummern} hängen an diesem Spiel`}
        </strong>
        <p className="fluid-xxs text-foreground leading-normal font-medium">
          Speichern kann dort und in den Spielen darunter ein eingetragenes Ergebnis löschen.
        </p>
      </div>
    </div>
  );
}
