"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { TrashBin } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { eraseSpielerAction } from "@/features/spieler/actions";
import { ERASURE_NEEDS_RETIREMENT } from "@/features/spieler/constants";
import { Callout } from "@/shared/components/ui/Callout";
import { DisabledHint } from "@/shared/components/ui/DisabledHint";
import { formButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { PANEL_REVEAL } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";

/**
 * The pupil's erasure, on `DELETE /spieler/{spieler_id}/erasure`. **A confirmation step and no undo**,
 * the draw's shape: one press removes the person, every squad row they hold and their values in the
 * log, and nothing writes any of the three back.
 */
export function FormLoeschenSection({
  spielerId,
  fullName,
  isRetired,
  membershipCount,
}: {
  spielerId: string;
  fullName: string;
  /** `REQ-PURGE-001`'s condition: whether the PERSON is retired, which is what the erasure needs. */
  isRetired: boolean;
  /** Every squad row this person holds, retired ones included — the erasure takes all of them. */
  membershipCount: number;
}) {
  const router = useRouter();
  const [isErasing, startErasing] = useTransition();
  const [isConfirming, setIsConfirming] = useState(false);

  const blockedReason = isRetired ? null : ERASURE_NEEDS_RETIREMENT;
  // The tone grades the act on offer, as the rollover's does: only where there is something to press.
  const panel = formPanel({ tone: blockedReason === null ? "danger" : "neutral" });

  /** One label-and-value row of the armed panel, the draw's readout in shape. */
  const renderUmfangRow = (label: string, value: string) => (
    <div className="flex flex-row items-baseline justify-between gap-x-3">
      <dt className="fluid-xxs text-foreground-muted font-bold">{label}</dt>
      <dd className="fluid-xs text-foreground min-w-0 text-right font-semibold">{value}</dd>
    </div>
  );

  const handleErase = () => {
    // No draft guard, unlike the anonymisation's: that one leaves a form standing whose next save
    // would write the cleared values back. Here the press removes the subject the draft describes.
    if (!isConfirming) {
      setIsConfirming(true);
      return;
    }

    startErasing(async () => {
      const res = await eraseSpielerAction({ id: spielerId });
      setIsConfirming(false);

      if (!res.success) {
        appToast.danger("Spieler nicht gelöscht", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
        return;
      }

      appToast.success("Spieler gelöscht", { description: res.message });
      // `replace`, never `push`: this page is the erased player's own and now answers not-found, so
      // Back must not return to it. The action's own revalidation is what refreshes the list.
      router.replace("/admin/spieler");
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Löschen
          <InfoHint label="Hinweis zum Löschen">
            <p>Der Weg, eine Person ganz aus der Verwaltung zu entfernen.</p>
            <ul>
              <li>
                Gelöscht werden <strong>die Person</strong>, <strong>alle ihre Kadereinträge</strong> aus jeder Saison und{" "}
                <strong>ihre Angaben im Änderungsprotokoll</strong>.
              </li>
              <li>
                Die Zeilen des Protokolls bleiben stehen und werden <strong>geleert</strong>: Dass etwas geschehen ist, bleibt lesbar; wen es
                betraf, nicht mehr.
              </li>
              <li>
                Möglich nur, solange der Spieler <strong>stillgelegt</strong> ist. Das Stilllegen ist der Schritt davor und lässt sich
                zurücknehmen.
              </li>
              <li>
                <strong>Zurückholen lässt sich danach nichts</strong>, auch nicht über das Protokoll.
              </li>
            </ul>
          </InfoHint>
        </h2>
      </div>

      <div className={panel.body()}>
        {blockedReason === null ? (
          <p className="fluid-sm text-foreground font-medium">
            Das Löschen entfernt <strong>{fullName}</strong> endgültig aus der Verwaltung: die Person selbst, alle ihre Kadereinträge und ihre
            Angaben im Änderungsprotokoll. Die Spiele bleiben unverändert, weil ein Spiel keinen Spieler nennt.
          </p>
        ) : (
          /* In the body as well as on the control: the hover hint is the only other place this is
             said, and the repair it names is on a different page. */
          <Callout
            severity="info"
            title="Dieser Spieler ist nicht stillgelegt">
            {blockedReason}
          </Callout>
        )}

        {/* Escalated in place, the draw's and the rollover's shape: without `role="alert"` the only
            signal is the button label quietly changing. */}
        {isConfirming && (
          <div
            role="alert"
            className={`${PANEL_REVEAL} bg-danger/5 border-danger/20 flex flex-col gap-4 rounded-xl border p-4 shadow-sm`}>
            <strong className="fluid-xs text-danger-strong">Bist Du Dir sicher?</strong>

            {/* Inside the alert rather than beside it: the figures ARE what the press is judged on,
                and a region announced without them asks for agreement to an unnamed person. */}
            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING}>Was dabei gelöscht wird</h3>
              <dl className="flex w-full flex-col gap-y-1">
                {renderUmfangRow("Person", fullName)}
                {renderUmfangRow("Kadereinträge", String(membershipCount))}
                {renderUmfangRow("Änderungsprotokoll", "Angaben werden geleert")}
              </dl>
            </div>

            {/* No restore is named, because none exists: the log keeps no image of an erased person,
                an image being a fresh copy of what the erasure destroyed. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              {fullName} verschwindet damit aus der Verwaltung und von jeder öffentlichen Seite. Zurückholen lässt sich das nicht: weder die
              Person noch ihre Kadereinträge noch ihre Angaben im Änderungsprotokoll.
            </p>
          </div>
        )}

        <div className="flex w-full flex-row flex-wrap items-center gap-3">
          {/* The reason is said on the control as well as in the body above it, the treatment the
              rollover established. `isErasing` is left out: it ends by itself. */}
          <DisabledHint reason={isErasing ? null : blockedReason}>
            <Button
              type="button"
              variant="primary"
              isDisabled={isErasing || blockedReason !== null}
              onPress={handleErase}
              className={`${formButton({ intent: isConfirming ? "destructive" : "submit" })} flex items-center gap-x-2`}>
              {!isConfirming && (
                <TrashBin
                  aria-hidden="true"
                  width={18}
                  height={18}
                />
              )}
              {/* The object stays in the label: on a danger panel under a trash icon, a bare „Ja, endgültig
                  löschen“ is agreed to without the reader having to hold what it refers to. */}
              {isErasing ? "Löscht..." : isConfirming ? "Ja, Spieler endgültig löschen" : "Spieler endgültig löschen"}
            </Button>
          </DisabledHint>
          {isConfirming && (
            <Button
              type="button"
              variant="secondary"
              isDisabled={isErasing}
              onPress={() => setIsConfirming(false)}
              className={formButton({ intent: "cancel" })}>
              Abbrechen
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
