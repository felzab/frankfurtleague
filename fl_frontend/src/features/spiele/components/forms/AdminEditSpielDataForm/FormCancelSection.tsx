import { Switch } from "@heroui/react";

import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";

import type { SpielBanner } from "./banners";

/**
 * **A cancelled match is not a match with no result**: the flag and `ergebnis` are independent, an
 * awarded fixture carrying both, so nothing here clears the result.
 */
export function FormCancelSection({
  spielIsCanceled,
  onSpielIsCanceledChange,
  banners,
}: {
  spielIsCanceled: boolean;
  onSpielIsCanceledChange: (value: boolean) => void;
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
        {/* No `aria-label`: the text below is inside the switch's own `<label>` already. */}
        <Switch
          name="is_canceled"
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

        {/* Announced, the admin having just done it. The unexpected consequence is that a
            cancelled fixture stops being reported under the four "fehlt" categories, quietly
            ending the chase for a date, a venue and a referee. */}
        <InlineBanners
          banners={banners}
          spot="absage-bedeutung"
          isAnnounced
        />

        {/* Separate from the general one, a single long callout being one that gets skipped. Not
            announced: two alerts for one switch flip is a scolding. */}
        <InlineBanners
          banners={banners}
          spot="absage-turnierbaum"
        />

        {/* Legal — a Wertung is entered like this — but also the shape a mistake takes, so a
            warning. Standing, not announced: it describes the combination, not the flip. */}
        <InlineBanners
          banners={banners}
          spot="absage-wertung"
        />
      </div>
    </section>
  );
}
