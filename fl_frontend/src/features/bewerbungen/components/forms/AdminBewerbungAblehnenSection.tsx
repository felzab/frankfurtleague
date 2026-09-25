"use client";

import { startTransition, useState } from "react";

import Ban from "@gravity-ui/icons/Ban";

import { FieldError } from "@heroui/react/field-error";
import { Label } from "@heroui/react/label";
import { TextArea } from "@heroui/react/textarea";

import { ablehnenBewerbungAction } from "@/features/bewerbungen/actions";
import { BEWERBUNG_GRUND_MAX_LENGTH } from "@/features/bewerbungen/constants";
import { FLAblehnenBewerbungPayloadSchema } from "@/features/bewerbungen/schemas";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import {
  FIELD_ERROR_CLASSES,
  FIELD_LABEL_CLASSES,
  FIELD_TEXTAREA_CLASSES,
  FORM_SECTION_HEADING_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { TextField } from "@/shared/components/ui/TextField";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { unansweredAction } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

/**
 * The cap and its wording are the write's own (`docs/frontend/spec.md :: I18`), asked of the field that
 * judges it: a second spelling here is a bound the two tiers can disagree about.
 */
const zuLangSatz = (grund: string): string | null => {
  const geprueft = FLAblehnenBewerbungPayloadSchema.shape.grund.safeParse(grund);

  return geprueft.success ? null : (geprueft.error.issues[0]?.message ?? null);
};

/**
 * The decline, on `POST /bewerbungen/{bewerbung_id}/ablehnen`. **A confirmation step and no undo**:
 * a decision is taken once (`REQ-BEWERBUNG-001`), and the reason typed here is stored and sent
 * verbatim to the people who applied.
 */
export function AdminBewerbungAblehnenSection({
  bewerbungId,
  teamName,
  saisonId,
  onGetipptChange,
}: {
  bewerbungId: string;
  /** The club this decline is about, or `null` where the application names none — the readout says so. */
  teamName: string | null;
  saisonId: string;
  /** Told whether a reason stands typed, which the acceptance's write would re-key the page over. */
  onGetipptChange: (getippt: boolean) => void;
}) {
  const twoPress = useTwoPressConfirm();
  const { isConfirming, press, cancel } = twoPress;

  const [grund, setGrund] = useState("");
  /** The refusal the API answered with, which lands on this field. Cleared on the next keystroke. */
  const [grundError, setGrundError] = useState<string | null>(null);
  /**
   * The bound's verdict, published when the field is left and only retracted by a keystroke: a
   * message between two keystrokes describes a reason nobody finished writing (`.claude/rules/frontend.md`).
   */
  const [laengeError, setLaengeError] = useState<string | null>(null);

  const panel = formPanel();

  /* One measured string for the gate, the counter and the preview:
     `fl_frontend/src/features/bewerbungen/schemas.ts :: FLAblehnenBewerbungPayloadSchema` trims before
     it measures, and the trimmed value is what the write carries and the school reads. */
  const trimmedGrund = grund.trim();

  const isEmpty = trimmedGrund === "";
  const zuLang = isEmpty ? null : zuLangSatz(grund);
  const error = grundError ?? laengeError;
  const closedReason = isEmpty ? "Schreibe zuerst einen Grund." : zuLang !== null ? "Kürze den Grund." : null;

  const handleDecline = () => {
    press(async () => {
      // A rejected action may still have saved, and uncaught here it takes the page down with it.
      const res = await ablehnenBewerbungAction({ id: bewerbungId, grund: grund }).catch(unansweredAction);

      // Wrapped again: the press runs this inside its transition, and React leaves an update after an
      // `await` outside it.
      startTransition(() => {
        if (!res.success) {
          const fieldError = res.fieldErrors?.grund ?? null;
          setGrundError(fieldError);

          if (fieldError === null) appToast.failure("Bewerbung nicht abgelehnt", res);
          return;
        }

        setGrundError(null);
        appToast.success("Bewerbung abgelehnt", { description: res.message });
      });
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
            if (next.trim() === "" || zuLangSatz(next) === null) setLaengeError(null);
            setGrund(next);
            onGetipptChange(next.trim() !== "");
            cancel();
          }}
          onBlur={() => setLaengeError(zuLang)}
          isInvalid={error !== null ? true : undefined}>
          <Label className={FIELD_LABEL_CLASSES}>Grund für die Absage</Label>
          <TextArea
            fullWidth
            placeholder="z.B. Für die Saison 2027 sind alle Plätze vergeben."
            className={`${FIELD_TEXTAREA_CLASSES} min-h-24`}
          />
          <FieldError className={FIELD_ERROR_CLASSES}>{error}</FieldError>
        </TextField>

        {/* The count, not a progress bar: what a writer needs near the cap is the number of
            characters left, and the field is refused above it rather than truncated. */}
        <p className="fluid-xxs text-foreground-muted font-medium">
          {String(trimmedGrund.length)} von {String(BEWERBUNG_GRUND_MAX_LENGTH)} Zeichen
        </p>

        {isConfirming && !isEmpty && (
          <ConfirmReveal>
            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING_CLASSES}>Was dabei abgeschlossen wird</h3>
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

        <ConfirmActionRow confirm={twoPress}>
          {/* On the control, never a sentence beside it that the first keystroke would unmount under the
              admin typing (`docs/frontend/spec.md` §1.14). */}
          <ConfirmPressButton
            confirm={twoPress}
            reason={closedReason}
            resting="Bewerbung ablehnen"
            armed="Ja, Absage verbindlich verschicken"
            running="Sagt ab..."
            icon={
              <Ban
                className="size-4.5"
                aria-hidden="true"
              />
            }
            onPress={handleDecline}
          />
        </ConfirmActionRow>
      </div>
    </section>
  );
}
