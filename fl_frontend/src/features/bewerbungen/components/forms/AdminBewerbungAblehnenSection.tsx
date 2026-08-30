"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Ban } from "@gravity-ui/icons";

import { Button, FieldError, Label, TextArea, TextField } from "@heroui/react";

import { ablehnenBewerbungAction } from "@/features/bewerbungen/actions";
import { BEWERBUNG_GRUND_MAX_LENGTH } from "@/features/bewerbungen/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { confirmButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, FIELD_LABEL, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

/** The sentence the disabled decline is described by. This control renders at most once per page. */
const ABSAGE_BUTTON_HINT_ID = "bewerbung-absage-hinweis";

const TOO_LONG = `Der Grund darf höchstens ${String(BEWERBUNG_GRUND_MAX_LENGTH)} Zeichen lang sein.`;

/**
 * The decline, on `POST /bewerbungen/{bewerbung_id}/ablehnen`. **A confirmation step and no undo**:
 * a decision is taken once (`REQ-BEWERBUNG-001`), and the reason typed here is stored and sent
 * verbatim to the people who applied.
 */
export function AdminBewerbungAblehnenSection({
  bewerbungId,
  teamName,
  saisonId,
}: {
  bewerbungId: string;
  /** The club this decline is about, or `null` where the application names none — the readout says so. */
  teamName: string | null;
  saisonId: string;
}) {
  const router = useRouter();
  const { isConfirming, isPending: isDeclining, press, cancel } = useTwoPressConfirm();

  const [grund, setGrund] = useState("");
  /** The refusal the API answered with, which lands on this field. Cleared on the next keystroke. */
  const [grundError, setGrundError] = useState<string | null>(null);

  const panel = formPanel();

  /* One measured string for the gate, the counter and the preview:
     `fl_frontend/src/features/bewerbungen/schemas.ts :: FLAblehnenBewerbungPayloadSchema` trims before
     it measures, and the trimmed value is what the write carries and the school reads. */
  const trimmedGrund = grund.trim();

  const isTooLong = trimmedGrund.length > BEWERBUNG_GRUND_MAX_LENGTH;
  const isEmpty = trimmedGrund === "";
  const error = grundError ?? (isTooLong ? TOO_LONG : null);

  const handleDecline = () => {
    // Ahead of `press`, so an empty or over-long reason neither arms nor writes. The button is
    // disabled in both states; this is what holds if a press reaches the handler anyway.
    if (isEmpty || isTooLong) return;

    press(async () => {
      const res = await ablehnenBewerbungAction({ id: bewerbungId, grund: grund });

      const fieldError = res.fieldErrors?.grund ?? null;
      setGrundError(fieldError);

      if (!res.success) {
        if (fieldError === null) appToast.danger("Absage fehlgeschlagen", { description: res.error ?? UNKNOWN_REFUSAL });
        return;
      }

      appToast.success("Bewerbung abgelehnt", { description: res.message });
      // The application is decided now, so this page has to come back showing that: the two decision
      // panels go and the Entscheidung block takes their place.
      router.refresh();
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title="Absage">
          <Hint
            mode="reveal"
            label="Hinweis zur Absage"
            body={{
              lead: "Die Absage schließt die Bewerbung ab.",
              points: [
                { term: "Der Grund", text: "steht in der E-Mail an die Kontaktpersonen, genau so, wie Du ihn hier schreibst." },
                { term: "Die Bewerbung selbst", text: "bleibt vollständig erhalten." },
              ],
            }}
          />
        </PanelHeading>
      </div>

      <div className={panel.body()}>
        <p className="muted-hint">Die Entscheidung wird mit Deinem Namen und dem heutigen Datum bei der Bewerbung gespeichert.</p>

        <TextField
          name="grund"
          value={grund}
          onChange={(next) => {
            setGrundError(null);
            setGrund(next);
            cancel();
          }}
          isInvalid={error !== null ? true : undefined}>
          <Label className={FIELD_LABEL}>Grund für die Absage</Label>
          <TextArea
            fullWidth
            placeholder="z.B. Für die Saison 2627 sind alle Plätze vergeben."
            className="border-border bg-surface text-foreground fluid-sm min-h-24 rounded-lg border px-3 py-2 transition-colors outline-none"
          />
          <FieldError className={FIELD_ERROR}>{error}</FieldError>
        </TextField>

        {/* The count, not a progress bar: what a writer needs near the cap is the number of
            characters left, and the field is refused above it rather than truncated. */}
        <p className="fluid-xxs text-foreground-muted font-medium">
          {String(trimmedGrund.length)} von {String(BEWERBUNG_GRUND_MAX_LENGTH)} Zeichen
        </p>

        {isConfirming && !isEmpty && (
          <ConfirmReveal>
            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING}>Was dabei abgeschlossen wird</h3>
              <dl className="flex w-full flex-col gap-y-1">
                <ConfirmReadoutRow
                  label="Team"
                  value={teamName ?? "Kein Team benannt"}
                />
                <ConfirmReadoutRow
                  label="Saison"
                  value={saisonId}
                />
              </dl>
            </div>

            {/* The reason stands unabridged: it is the one thing the message exists to hand over, and
                a shortened preview would let a sentence go out that nobody read whole. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Diese Begründung geht so an die Kontaktpersonen: „{trimmedGrund}“
            </p>

            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Es gibt in der Verwaltung keinen Weg zurück. Über eine Bewerbung wird einmal entschieden, und die Absage geht sofort raus.
            </p>
          </ConfirmReveal>
        )}

        <div className="flex w-full flex-col gap-y-1.5">
          <ConfirmActionRow
            isConfirming={isConfirming}
            isPending={isDeclining}
            onCancel={cancel}>
            <Button
              type="button"
              variant="primary"
              aria-describedby={!isDeclining && (isEmpty || isTooLong) ? ABSAGE_BUTTON_HINT_ID : undefined}
              isDisabled={isDeclining || isEmpty || isTooLong}
              onPress={handleDecline}
              className={confirmButton(isConfirming)}>
              {!isConfirming && (
                <Ban
                  aria-hidden="true"
                  width={18}
                  height={18}
                />
              )}
              {isDeclining ? "Sagt ab..." : isConfirming ? "Ja, Absage verbindlich verschicken" : "Bewerbung ablehnen"}
            </Button>
          </ConfirmActionRow>

          {!isDeclining && (isEmpty || isTooLong) && (
            <Hint
              mode="inline"
              describes={ABSAGE_BUTTON_HINT_ID}
              text={isEmpty ? "Schreibe zuerst einen Grund." : "Kürze den Grund."}
            />
          )}
        </div>
      </div>
    </section>
  );
}
