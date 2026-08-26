"use client";

import { useRouter } from "next/navigation";

import { TrashBin } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { eraseSpielerAction } from "@/features/spieler/actions";
import { ERASURE_NEEDS_RETIREMENT } from "@/features/spieler/constants";
import { Callout } from "@/shared/components/ui/Callout";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { confirmButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

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
  // No draft guard, unlike the anonymisation's: that one leaves a form standing whose next save would
  // write the cleared values back. Here the press removes the subject the draft describes.
  const { isConfirming, isPending: isErasing, press, cancel } = useTwoPressConfirm();

  const blockedReason = isRetired ? null : ERASURE_NEEDS_RETIREMENT;
  const panel = formPanel({ tone: blockedReason === null ? "danger" : "neutral" });

  const handleErase = () => {
    press(async () => {
      const res = await eraseSpielerAction({ id: spielerId });

      if (!res.success) {
        appToast.danger("Spieler nicht gelöscht", { description: res.error ?? UNKNOWN_REFUSAL });
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
          <Hint
            mode="reveal"
            label="Hinweis zum Löschen"
            body={{
              lead: "Der Weg, eine Person ganz aus der Verwaltung zu entfernen.",
              points: [{ term: "Das Änderungsprotokoll", text: "behält seine Zeilen und verliert nur die Angaben zur Person." }],
            }}
          />
        </h2>
      </div>

      <div className={panel.body()}>
        {blockedReason === null ? (
          <p className="muted-hint">
            Das Löschen entfernt <strong>{fullName}</strong> endgültig aus der Verwaltung: die Person selbst, alle ihre Kadereinträge und ihre
            Angaben im Änderungsprotokoll. Die Spiele bleiben unverändert.
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

        {isConfirming && (
          <ConfirmReveal>
            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING}>Was dabei gelöscht wird</h3>
              <dl className="flex w-full flex-col gap-y-1">
                <ConfirmReadoutRow
                  label="Person"
                  value={fullName}
                />
                <ConfirmReadoutRow
                  label="Kadereinträge"
                  value={String(membershipCount)}
                />
                <ConfirmReadoutRow
                  label="Änderungsprotokoll"
                  value="Angaben werden geleert"
                />
              </dl>
            </div>

            {/* No restore is named, because none exists: the log keeps no image of an erased person,
                an image being a fresh copy of what the erasure destroyed. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              {fullName} verschwindet damit aus der Verwaltung und von jeder öffentlichen Seite, mitsamt allen Kadereinträgen und allen Angaben
              im Änderungsprotokoll. Zurückholen lässt sich das nicht.
            </p>
          </ConfirmReveal>
        )}

        <ConfirmActionRow
          isConfirming={isConfirming}
          isPending={isErasing}
          onCancel={cancel}>
          {/* The reason is said on the control as well as in the body above it, the treatment the
              rollover established. `isErasing` is left out: it ends by itself. */}
          <Hint
            mode="refusal"
            reason={isErasing ? null : blockedReason}>
            <Button
              type="button"
              variant="primary"
              isDisabled={isErasing || blockedReason !== null}
              onPress={handleErase}
              className={confirmButton(isConfirming)}>
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
          </Hint>
        </ConfirmActionRow>
      </div>
    </section>
  );
}
