import { Switch } from "@heroui/react";

import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import type { SpielBanner } from "./banners";

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
  spielIsCanceled,
  onSpielIsCanceledChange,
  banners,
}: {
  spielIsCanceled: boolean;
  onSpielIsCanceledChange: (value: boolean) => void;
  /** The editor's whole Hinweis list; the three spots below take their own entries out of it. */
  banners: readonly SpielBanner[];
}) {
  const styles = formPanel({ tone: "danger" });

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

        {/* Announced, because the admin has just done it. The consequence nobody expects is that
            `categorizeActionRequired` reports a cancelled fixture as cancelled and stops reporting it
            under any of the four "fehlt" categories, so an absage quietly ends the chase for a date,
            a venue and a referee. */}
        <InlineBanners
          banners={banners}
          spot="absage-bedeutung"
          isAnnounced
        />

        {/* The knockout-specific consequence, separate from the general one because it is the costlier
            half and a single long callout is a callout that gets skipped (ADR-0040). Not announced: the
            general callout above already interrupts, and two alerts for one switch flip is a scolding. */}
        <InlineBanners
          banners={banners}
          spot="absage-turnierbaum"
        />

        {/* Legal — a Wertung is entered exactly like this — but also the shape a mistaken
            cancellation takes, so a warning rather than silence or a refusal. Standing, not
            announced: it describes the combination, not the flip the admin just made. */}
        <InlineBanners
          banners={banners}
          spot="absage-wertung"
        />
      </div>
    </section>
  );
}
