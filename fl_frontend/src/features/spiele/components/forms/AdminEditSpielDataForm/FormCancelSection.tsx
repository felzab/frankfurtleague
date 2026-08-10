import { Switch } from "@heroui/react";

import { Callout } from "@/shared/components/ui/Callout";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";

import type { FLSpiel } from "@/features/spiele/schemas";

/**
 * Whether the fixture was called off.
 *
 * **Its own panel, last, and in the danger tone.** `is_canceled` is the one control on this form that
 * describes the fixture rather than its data, and it used to sit above the fields — so the destructive
 * answer was where the eye lands first. Last is the danger-zone position of every settings page this will be compared to.
 *
 * **A cancelled match is not a match with no result.** The flag and the `ergebnis` are independent: a
 * fixture awarded without being played carries both, and that is what makes it count in the league table
 * (ADR-0019). Nothing here clears the result.
 *
 * The hint that used to sit under the switch is gone: the callout below says the same thing and more, and
 * a hint earns its place only by saying something the others do not (ADR-0040).
 */
export function FormCancelSection({
  spielData,
  spielIsCanceled,
  onSpielIsCanceledChange,
  dependentSpiele,
  hasDecidedErgebnis,
}: {
  spielData: FLSpiel;
  spielIsCanceled: boolean;
  onSpielIsCanceledChange: (value: boolean) => void;
  /** Fixtures whose occupants this one's result decides — the form's own derivation, reused here. */
  dependentSpiele: readonly FLSpiel[];
  /** The draft carries a decided (non-draw) score — the form computes it once for this callout
   * and the rail's mirror alike. */
  hasDecidedErgebnis: boolean;
}) {
  const styles = formPanel({ tone: "danger" });

  // Only for the fixture the admin is calling off in THIS edit. A fixture that was already cancelled
  // gets the rail's standing note instead: nobody just did it, so nothing should be announced.
  const isBeingCalledOff = spielIsCanceled && !spielData.is_canceled;

  // A knockout fixture that feeds later rounds: calling it off leaves every slot wired to its outcome
  // with nothing to resolve from. The group phase is exempt — the table ignores a cancelled fixture
  // (ADR-0019).
  const breaksBracket = isBeingCalledOff && spielData.saison_phase !== "gruppenphase" && dependentSpiele.length > 0;
  const dependentNummern = new Intl.ListFormat("de-DE", { style: "long", type: "conjunction" }).format(
    dependentSpiele.map((spiel) => String(spiel.spiel_nr)),
  );

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Absage
          <InfoHint label="Hinweis zur Absage">
            <p>Ein abgesagtes Spiel findet nicht statt.</p>
            <ul>
              <li>
                Es erscheint überall als <strong>abgesagt</strong> und wird nicht mehr angemahnt.
              </li>
              <li>
                Ein eingetragenes <strong>Ergebnis bleibt stehen</strong> und zählt weiter für die Tabelle.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={styles.body()}>
        {/* No `aria-label`: "Spiel absagen" below sits inside the switch's own <label>, so an
            aria-label would only override the visible text with a copy of itself. */}
        <Switch
          size="md"
          isSelected={spielIsCanceled}
          onChange={onSpielIsCanceledChange}>
          <Switch.Content className="fluid-sm text-danger flex h-fit w-fit flex-row items-center gap-x-3 font-bold">
            Spiel absagen
            <Switch.Control className={spielIsCanceled ? "bg-danger" : ""}>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Content>
        </Switch>

        {/* Announced, because the admin has just done it. The first sentence is the consequence nobody
            expects: `categorizeActionRequired` reports a cancelled fixture as cancelled and stops
            reporting it under any of the four "fehlt" categories, so an absage quietly ends the chase
            for a date, a venue and a referee. The second is the one that stops an admin undoing a
            forfeit by mistake. */}
        {isBeingCalledOff && (
          <Callout
            severity="danger"
            isAnnounced
            title="Abgesagt heißt: das Spiel findet nicht statt">
            Es erscheint überall als abgesagt und wird nicht mehr angemahnt. Ein eingetragenes Ergebnis bleibt stehen und zählt weiter für die
            Tabelle.
          </Callout>
        )}

        {/* The knockout-specific consequence, separate from the general one because it is the costlier
            half and a single long callout is a callout that gets skipped (ADR-0040). Not announced: the
            general callout above already interrupts, and two alerts for one switch flip is a scolding. */}
        {breaksBracket && (
          <Callout
            severity="danger"
            title="Dieses KO-Spiel speist andere Spiele">
            Ohne seinen Ausgang {dependentSpiele.length === 1 ? `bleibt Spiel ${dependentNummern}` : `bleiben die Spiele ${dependentNummern}`}{" "}
            und die Runden darunter unbesetzt.
          </Callout>
        )}

        {/* Legal — a Wertung is entered exactly like this — but also the shape a mistaken
            cancellation takes, so a warning rather than silence or a refusal. Standing, not
            announced: it describes the combination, not the flip the admin just made. */}
        {spielIsCanceled && hasDecidedErgebnis && (
          <Callout
            severity="warning"
            title="Abgesagt, aber mit entschiedenem Ergebnis">
            Das kann beabsichtigt sein, etwa bei einer Wertung. Das Ergebnis zählt weiter für die Tabelle.
          </Callout>
        )}
      </div>
    </section>
  );
}
