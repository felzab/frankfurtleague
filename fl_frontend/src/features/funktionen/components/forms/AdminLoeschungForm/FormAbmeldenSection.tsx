"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import ArrowRightFromSquare from "@gravity-ui/icons/ArrowRightFromSquare";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { UEBERALL_ABMELDEN } from "@/features/admin/constants";
import { endAnmeldungenAction } from "@/features/funktionen/actions";
import { FLAbmeldungPayloadSchema } from "@/features/funktionen/schemas";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { TextField } from "@/shared/components/ui/TextField";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

/**
 * Ends every session of one address, barring nothing and mailing nobody. Two
 * presses, as the account page's own sign-out of every other device: it ends sessions on devices nobody here sees.
 */
export function FormAbmeldenSection() {
  const router = useRouter();
  // The armed press asks the passkey as the erasure's and the ban's do: nothing brings an ended session back.
  const twoPress = useTwoPressConfirm({ stepUp: true });
  const { isConfirming, isPending } = twoPress;
  const [email, setEmail] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);

  const panel = formPanel();

  const handlePress = () => {
    if (!isConfirming) {
      // Judged at the press and never between keystrokes, in the write's own words.
      const geprueft = FLAbmeldungPayloadSchema.shape.email.safeParse(email);
      setFehler(geprueft.success ? null : (geprueft.error.issues[0]?.message ?? null));
      if (!geprueft.success) return;
    }

    // Read at the press: an edit of the box disarms, so the address armed on is the one sent.
    const gesendet = { email: email };
    twoPress.press(async () => {
      // A rejected action may still have written its log row, and uncaught here it takes the page down with it.
      const res = await endAnmeldungenAction(gesendet).catch(rejectedWrite(router));

      // Wrapped again: the press runs this inside its transition, and React leaves an update after an `await` outside it.
      startTransition(() => {
        if (!res.success) {
          setFehler(res.fieldErrors?.email ?? null);
          appToast.failure("Nicht abgemeldet", res);
          return;
        }

        setEmail("");
        if (res.konto) appToast.success("Abgemeldet", { description: res.message });
        else appToast.warning("Kein Konto", { description: res.message });
      });
    });
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <PanelHeading
          className={panel.heading()}
          title={UEBERALL_ABMELDEN}
        />
      </div>

      <div className={panel.body()}>
        <TextField
          type="email"
          name="email"
          value={email}
          isDisabled={isPending}
          onChange={(next) => {
            setEmail(next);
            setFehler(null);
            twoPress.cancel();
          }}
          isInvalid={fehler !== null ? true : undefined}>
          <Label className={FIELD_LABEL_CLASSES}>E-Mail</Label>
          {/* Off, as the erasure's box is: the browser keeps no address typed here. */}
          <Input
            autoComplete="off"
            placeholder="z.B. name@beispiel.de"
            className={FIELD_INPUT_CLASSES}
          />
          <FieldError className={FIELD_ERROR_CLASSES}>{fehler}</FieldError>
        </TextField>

        {isConfirming && (
          <ConfirmReveal>
            <p className="fluid-xxs leading-normal font-medium text-foreground">
              Beendet jede Anmeldung dieser Adresse auf allen Geräten. Gesperrt wird die Adresse dadurch nicht, und es geht keine E-Mail an sie.
            </p>
          </ConfirmReveal>
        )}

        <ConfirmActionRow confirm={twoPress}>
          <ConfirmPressButton
            confirm={twoPress}
            reason={email.trim() === "" ? "Gib zuerst die E-Mail-Adresse ein." : null}
            resting={UEBERALL_ABMELDEN}
            armed="Ja, überall abmelden"
            running="Meldet ab..."
            icon={
              <ArrowRightFromSquare
                aria-hidden="true"
                className="size-4.5 shrink-0"
              />
            }
            onPress={handlePress}
          />
        </ConfirmActionRow>
      </div>
    </section>
  );
}
