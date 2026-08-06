import { Switch } from "@heroui/react";

import { Callout } from "@/shared/components/ui/Callout";
import { formPanel } from "@/shared/components/ui/formPanel";

import type { FLSpiel } from "@/features/spiele/schemas";

/**
 * Whether the fixture was called off.
 *
 * **Its own panel, last, and in the danger tone.** `is_canceled` is the one control on this form that
 * describes the fixture rather than its data, and it used to sit above the fields — so the destructive
 * answer was where the eye lands first. Last is the danger-zone position every settings page the owner
 * will compare this to uses.
 *
 * **A cancelled match is not a match with no result.** The flag and the `ergebnis` are independent: a
 * fixture awarded without being played carries both, and that is what makes it count in the league table
 * (ADR-0026). Nothing here clears the result.
 *
 * The hint that used to sit under the switch is gone: the callout below says the same thing and more, and
 * a hint earns its place only by saying something the others do not (ADR-0050).
 */
export function FormCancelSection({
  spielData,
  spielIsCanceled,
  onSpielIsCanceledChange,
}: {
  spielData: FLSpiel;
  spielIsCanceled: boolean;
  onSpielIsCanceledChange: (value: boolean) => void;
}) {
  const styles = formPanel({ tone: "danger" });

  // Only for the fixture the admin is calling off in THIS edit. A fixture that was already cancelled
  // gets the rail's standing note instead: nobody just did it, so nothing should be announced.
  const isBeingCalledOff = spielIsCanceled && !spielData.is_canceled;

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>Absage</h2>
        <p className={styles.hint()}>Wenn das Spiel nicht stattfindet.</p>
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
            Es erscheint überall als abgesagt und verschwindet aus den offenen Aufgaben — Datum, Ort und Schiedsrichter werden dort nicht mehr
            angemahnt. Ein eingetragenes Ergebnis bleibt stehen und zählt weiter für die Tabelle.
          </Callout>
        )}
      </div>
    </section>
  );
}
