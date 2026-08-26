"use client";

import { useRouter } from "next/navigation";

import { CalendarXmark } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { undrawSpielplanAction } from "@/features/saisons/actions";
import { RECORDED_FACTS_NONE } from "@/features/saisons/constants";
import { describeAngesetzteSpiele, describeSpielplanUmfang } from "@/features/saisons/utils";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { DisabledHint } from "@/shared/components/ui/DisabledHint";
import { confirmButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";

import { spielplanUndrawBlockedReason } from "./blockedReasons";

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { SpielplanBestand } from "@/features/saisons/types";

/**
 * Taking the season's draw back, on `DELETE /saisons/{saison_id}/spielplan`. **A confirmation step
 * and no undo**, nothing writing the removed rows back (`docs/backend/spec.md :: I26`).
 */
export function FormSpielplanRuecknahmeSection({
  saisonId,
  saisonStatus,
  hasSpielplan,
  spieltageCount,
  bestand,
  hasDrawnSpiele,
  onBeforeUndraw,
}: {
  saisonId: string;
  saisonStatus: FLSaisonStatus;
  /** The watermark can stand with neither collection behind it, which is a season this press still clears. */
  hasSpielplan: boolean;
  /** Retired matchday rows are counted too: all of them go. */
  spieltageCount: number;
  /** What the press destroys, and the `erfasst` figure `REQ-SPIELPLAN-006` weighs against it. */
  bestand: SpielplanBestand;
  /** `REQ-SPIELPLAN-006`'s other half: the season holds fixtures, whoever put them there. */
  hasDrawnSpiele: boolean;
  /** Runs before the write; `false` cancels. The editor refuses while a draft is unsaved. */
  onBeforeUndraw: () => boolean;
}) {
  const router = useRouter();
  const { isConfirming, isPending: isUndrawing, press, cancel } = useTwoPressConfirm(onBeforeUndraw);

  const blockedReason = spielplanUndrawBlockedReason({
    saisonStatus,
    hasSpielplan,
    hasDrawnSpiele,
    spieltageCount,
    erfassteSpieleCount: bestand.erfasst,
  });

  const panel = formPanel({ tone: blockedReason === null ? "danger" : "neutral" });

  const handleUndraw = () => {
    press(async () => {
      const res = await undrawSpielplanAction({ id: saisonId });

      if (!res.success) {
        appToast.danger("Spielplan nicht zurückgenommen", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
        return;
      }

      // Its own grade rather than a plain success: „zurückgenommen“ over a season that held nothing
      // would claim work nobody did. Not a failure either, a 200 with zeroes being the state asked for.
      const removedNothing = res.undraw !== undefined && res.undraw.spieltage === 0 && res.undraw.spiele === 0 && !res.undraw.watermark_cleared;

      const report = removedNothing ? appToast.info : appToast.success;
      report(removedNothing ? "Kein Spielplan vorhanden" : "Spielplan zurückgenommen", { description: res.message });

      // The action's invalidation reaches the caches; this re-renders the page the admin stands on,
      // where the rules panel is now open again and the draw above offers a first draw.
      router.refresh();
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Spielplan zurücknehmen
          <InfoHint label="Hinweis zum Zurücknehmen">
            <p>Das Zurücknehmen löscht die Spieltage und alle Spiele dieser Saison in einem Schritt.</p>
            <ul>
              <li>
                Gelöscht werden <strong>alle Spieltage</strong> und <strong>alle Spiele</strong> dieser Saison, mit jedem Termin und jeder
                Uhrzeit, die schon eingetragen sind.
              </li>
              <li>
                Möglich nur, solange die Saison <strong>geplant</strong> ist und zu keinem ihrer Spiele etwas eingetragen wurde:{" "}
                {RECORDED_FACTS_NONE}.
              </li>
              <li>
                Danach lassen sich <strong>Gruppen</strong>, <strong>Teams pro Gruppe</strong> und <strong>Qualifikanten</strong> im Abschnitt{" "}
                <strong>Regeln</strong> wieder einzeln ändern, und die Teams dieser Saison über die <strong>Teamseite</strong>.
              </li>
              <li>
                Den Spielplan legst Du danach im Abschnitt <strong>Spielplan</strong> neu an. Er wird dabei frisch gezogen:{" "}
                <strong>Zurückholen lässt sich der alte in der Verwaltung nicht.</strong>
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {blockedReason === null ? (
          <p className="fluid-sm text-foreground font-medium">
            Zurücknehmen löscht die Spieltage und Spiele, die Saison <strong>{saisonId}</strong> jetzt hält. Termine und Uhrzeiten, die schon
            eingetragen sind, gehen dabei verloren. Danach hat die Saison keinen Spielplan mehr, und Gruppen, Teams pro Gruppe und Qualifikanten
            lassen sich im Abschnitt Regeln wieder einzeln ändern.
          </p>
        ) : (
          /* In the body as well as on the control: `DisabledHint` opens on hover and on focus alone,
             so a reader who never points at a closed button would otherwise never learn why. */
          <p className="fluid-sm text-foreground-muted font-medium">{blockedReason}</p>
        )}

        {isConfirming && (
          <ConfirmReveal>
            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING}>Was dabei gelöscht wird</h3>
              <dl className="flex w-full flex-col gap-y-1">
                <ConfirmReadoutRow
                  label="Bisher angelegt"
                  value={describeSpielplanUmfang(spieltageCount, bestand.spiele)}
                />
                {/* No refusal reads this figure, which is why it is stated: a fully dated season is
                    taken back as readily as an undated one. */}
                <ConfirmReadoutRow
                  label="Mit Termin oder Uhrzeit"
                  value={describeAngesetzteSpiele(bestand.angesetzt)}
                />
              </dl>
            </div>

            {/* No restore is named. The action log keeps an image of every removed document, but that
                is a record for a person to read and no endpoint replays it. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Saison {saisonId} hat danach keine Spieltage und keine Spiele mehr, und jeder Termin und jede Uhrzeit, die schon eingetragen sind,
              gehen mit ihnen. Ein neuer Spielplan wird frisch gezogen. Zurückholen lässt sich der alte in der Verwaltung nicht.
            </p>
          </ConfirmReveal>
        )}

        <ConfirmActionRow
          isConfirming={isConfirming}
          isPending={isUndrawing}
          onCancel={cancel}>
          {/* The reason is said on the control as well as in the body above it, the treatment the
              rollover established. `isUndrawing` is left out: it ends by itself. */}
          <DisabledHint reason={isUndrawing ? null : blockedReason}>
            <Button
              type="button"
              variant="primary"
              isDisabled={isUndrawing || blockedReason !== null}
              onPress={handleUndraw}
              className={confirmButton(isConfirming)}>
              {!isConfirming && (
                <CalendarXmark
                  aria-hidden="true"
                  width={18}
                  height={18}
                />
              )}
              {/* The object stays in the label: under a danger heading a bare „Ja, zurücknehmen“ is
                  agreed to without the reader having to hold what it refers to. */}
              {isUndrawing ? "Wird zurückgenommen..." : isConfirming ? "Ja, Spielplan zurücknehmen" : "Spielplan zurücknehmen"}
            </Button>
          </DisabledHint>
        </ConfirmActionRow>
      </div>
    </section>
  );
}
