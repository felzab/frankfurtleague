"use client";

import { useTransition } from "react";

import { Button } from "@heroui/react";

import { deleteSaisonSpielerAction, reactivateSaisonSpielerAction } from "@/features/spieler/actions";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { InlineBanners } from "@/shared/components/ui/InlineBanners";
import { appToast } from "@/shared/utils/appToast";

import type { SpielerBanner } from "./banners";

/**
 * Takes a player out of ONE season's squad, writing to `saison_spieler` and nothing else. Retiring
 * the PERSON is a different control with a different endpoint, in the page header.
 */
export function FormAustragenSection({
  spielerId,
  saisonId,
  rowInactiveSince,
  banners,
}: {
  spielerId: string;
  saisonId: string;
  /** The day the ROW was retired, or null — which of the two controls this panel offers. */
  rowInactiveSince: string | null;
  banners: readonly SpielerBanner[];
}) {
  const styles = formPanel({ tone: "danger" });
  const [isPending, startWriting] = useTransition();

  const isAusgetragen = rowInactiveSince !== null;

  const run = (write: () => Promise<{ success: boolean; message?: string; error?: string }>, failureHeading: string) => {
    startWriting(async () => {
      const res = await write();
      if (res.success) appToast.success(res.message ?? "Gespeichert!");
      else appToast.danger(failureHeading, { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
    });
  };

  return (
    <section className={styles.root()}>
      <div className={styles.header()}>
        <h2 className={styles.heading()}>
          Kadereintrag
          <InfoHint label="Hinweis zum Austragen">
            <p>Der Weg aus dem Kader einer Saison.</p>
            <ul>
              <li>
                Es betrifft <strong>nur diese Saison</strong>. Der Spieler bleibt in der Liga und in jeder anderen Saison, in der er steht.
              </li>
              <li>
                <strong>Nummer, Position und Stufe bleiben erhalten</strong> und kehren beim Reaktivieren zurück.
              </li>
              <li>Den Spieler ganz stillzulegen ist etwas anderes und steht oben auf der Seite.</li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={styles.body()}>
        {isAusgetragen ? (
          <>
            <InlineBanners
              banners={banners}
              spot="austragen"
            />
            <Button
              type="button"
              variant="primary"
              isDisabled={isPending}
              onPress={() =>
                run(() => reactivateSaisonSpielerAction({ spieler_id: spielerId, saison_id: saisonId }), "Reaktivieren fehlgeschlagen")
              }
              className={`${formButton({ intent: "submit" })} w-fit`}>
              {isPending ? "Speichert..." : "Kadereintrag reaktivieren"}
            </Button>
          </>
        ) : (
          <>
            <p className="fluid-sm text-foreground-muted font-medium">
              Der Spieler verschwindet aus dem Kader der Saison {saisonId}. Sein Eintrag bleibt gespeichert und kann jederzeit reaktiviert
              werden.
            </p>
            {/* A button, not a draft field: one fact with nothing to fill in, and `reactivate` restores
                it. Its own shape, so it does not read as the page's primary action. */}
            <Button
              type="button"
              variant="secondary"
              isDisabled={isPending}
              onPress={() => run(() => deleteSaisonSpielerAction({ spieler_id: spielerId, saison_id: saisonId }), "Austragen fehlgeschlagen")}
              className="border-danger/40 bg-surface text-danger data-hovered:bg-hover-danger data-hovered:text-danger-strong fluid-sm flex h-10 w-fit items-center rounded-lg border px-4 font-bold shadow-sm transition-colors">
              {isPending ? "Speichert..." : `Aus Kader ${saisonId} austragen`}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
