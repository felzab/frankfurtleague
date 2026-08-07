"use client";

import { useTransition } from "react";

import { Button } from "@heroui/react";

import { deleteSaisonSpielerAction, reactivateSaisonSpielerAction } from "@/features/spieler/actions";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

/**
 * Taking a player out of ONE season's squad — the editor's danger zone, in the same shape as the club
 * editor's Disqualifikation panel and the match editor's Absage (owner, 2026-08-07: last on the page,
 * in the danger tone).
 *
 * **It writes to `saison_spieler` and nothing else.** The person is untouched: they stay in the
 * league, keep every other season's squad rows, and remain in every picker. Retiring the PERSON is a
 * different control with a different endpoint, and it lives in the page header where the rest of the
 * person's identity is.
 *
 * **A button rather than a switch, unlike the disqualification beside it.** A disqualification is a
 * RECORD the admin composes — a reason and a date — so it is a draft the save bar commits. This is a
 * single fact with nothing to fill in, so it fires its own action immediately: there is no
 * half-entered state for the save bar to hold, and putting it there would leave the page's one
 * irreversible-looking control indistinguishable from a typo in a name field.
 *
 * Reversible either way, which is why the button is not a confirmation dialog: the row is soft
 * deleted (ADR-0032) and `reactivate` restores it with the number, position and stufe it still
 * carries. That is the same argument ADR-0051 makes for an undo over a confirmation.
 */
export function FormAustragenSection({
  spielerId,
  saisonId,
  rowInactiveSince,
}: {
  spielerId: string;
  saisonId: string;
  /** The day the ROW was retired, or null — which of the two controls this panel offers. */
  rowInactiveSince: string | null;
}) {
  const styles = formPanel({ tone: "danger" });
  const [isPending, startWriting] = useTransition();

  const isAusgetragen = rowInactiveSince !== null;

  const run = (write: () => Promise<{ success: boolean; message?: string; error?: string }>, failureHeading: string) => {
    startWriting(async () => {
      const res = await write();
      if (res.success) appToast.success(res.message ?? "Gespeichert!");
      else appToast.danger(failureHeading, { description: res.error || "Ein unerwarteter Fehler ist aufgetreten." });
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
            <Callout
              severity="info"
              title={`Ausgetragen seit ${formatSpielDatum(rowInactiveSince)}`}>
              Der Spieler zählt in der Saison {saisonId} zu keinem Kader. Nummer, Position und Stufe sind gespeichert und kehren beim
              Reaktivieren zurück.
            </Callout>
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
            {/* The danger button's own shape, so it does not read as the page's primary action —
                the save bar below owns that. */}
            <Button
              type="button"
              variant="secondary"
              isDisabled={isPending}
              onPress={() => run(() => deleteSaisonSpielerAction({ spieler_id: spielerId, saison_id: saisonId }), "Austragen fehlgeschlagen")}
              className="border-danger/40 bg-surface text-danger hover:bg-danger/10 fluid-sm flex h-10 w-fit items-center rounded-lg border px-4 font-bold shadow-sm transition-colors">
              {isPending ? "Speichert..." : `Aus Kader ${saisonId} austragen`}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
