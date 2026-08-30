"use client";

import { useRouter } from "next/navigation";

import { TrashBin } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { eraseKontaktpersonAction } from "@/features/kontakte/actions";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { confirmButton } from "@/shared/components/ui/formButtons";
import { FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { guardAgainstDraft } from "@/shared/utils/draftGuard";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

/** What the draft guard says here: the write lands on the server and this page re-reads after it. */
const DRAFT_IN_THE_WAY = "Das Löschen liest die Seite neu und verwirft die nicht gespeicherten Änderungen.";

/**
 * One contact person's erasure, from inside their own panel.
 *
 * **Keyed on the ADDRESS, not on this row**: it clears every seat that address holds, in every season
 * and both collections. Confirmed in place, so the reader sees whose data it is.
 */
export function FormKontaktErasure({ email, fullName, isDirty }: { email: string; fullName: string; isDirty: boolean }) {
  const router = useRouter();
  const { isConfirming, isPending, press, cancel } = useTwoPressConfirm();

  const handleErase = () => {
    if (!guardAgainstDraft(isDirty, DRAFT_IN_THE_WAY)) return;

    press(async () => {
      const res = await eraseKontaktpersonAction({ email });

      if (!res.success) {
        appToast.danger("Kontaktperson nicht gelöscht", { description: res.error ?? UNKNOWN_REFUSAL });
        return;
      }

      /* The endpoint refuses nothing, so an address matching nobody succeeds and clears zero, and
         reporting that as „gelöscht“ would be a lie of the quiet kind. */
      if (res.cleared === 0) appToast.warning("Nichts gefunden", { description: res.message });
      else appToast.success("Kontaktperson gelöscht", { description: res.message });

      // Stays on the page: the erasure nulls the SLOT, never the block, so this row survives with the
      // other two seats standing. A refresh is what shows the seat empty.
      router.refresh();
    });
  };

  // The seat's own sub-block rule, as the Einwilligung block above it uses: one divider treatment per
  // depth. The destructive grading is the confirm reveal's and the button's, both recipes.
  return (
    <div className="border-border/60 flex w-full flex-col gap-y-4 border-t pt-4">
      <h4 className={FORM_SECTION_HEADING}>Kontaktperson löschen</h4>

      <p className="muted-hint">
        Löscht <strong>{fullName}</strong> überall, nicht nur hier. Für eine Person, die vergessen werden möchte.
      </p>

      {isConfirming && (
        <ConfirmReveal>
          <div className="flex w-full flex-col gap-y-1">
            <h4 className={FORM_SECTION_HEADING}>Was dabei gelöscht wird</h4>
            <dl className="flex w-full flex-col gap-y-1">
              <ConfirmReadoutRow
                label="Person"
                value={fullName}
              />
              {/* The reach, stated because the control now sits on a page showing ONE season: without
                  these three rows it reads as clearing this seat. */}
              <ConfirmReadoutRow
                label="Saison-Zugehörigkeiten"
                value="jede, in der diese Adresse steht"
              />
              <ConfirmReadoutRow
                label="Bewerbungen"
                value="jede, in der diese Adresse steht"
              />
              <ConfirmReadoutRow
                label="Änderungsprotokoll"
                value="gesicherte Stände werden geleert"
              />
            </dl>
          </div>

          <p className="fluid-xxs text-foreground leading-normal font-medium">
            {fullName} wird aus jeder Saison und jeder Bewerbung entfernt, in der diese E-Mail-Adresse steht, und im Änderungsprotokoll bleibt
            dazu kein gesicherter Stand. Zurückholen lässt sich das nicht.
          </p>
        </ConfirmReveal>
      )}

      <ConfirmActionRow
        isConfirming={isConfirming}
        isPending={isPending}
        onCancel={cancel}>
        <Button
          type="button"
          variant="primary"
          isDisabled={isPending}
          onPress={handleErase}
          className={confirmButton(isConfirming)}>
          {/* Dropped while armed, as every two-press control here drops it: the glyph announces the
              press, and step two is already announcing itself in words. */}
          {!isConfirming && (
            <TrashBin
              aria-hidden="true"
              width={18}
              height={18}
            />
          )}
          {/* The object stays in the label: a bare „Ja, endgültig löschen“ reads as whatever the page
              is about, and this one reaches every season rather than this seat. */}
          {isPending ? "Löscht..." : isConfirming ? "Ja, Kontaktperson endgültig löschen" : "Kontaktperson löschen"}
        </Button>
      </ConfirmActionRow>
    </div>
  );
}
