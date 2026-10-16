"use client";

import { startTransition, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Ban from "@gravity-ui/icons/Ban";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { postSperreAction, readSperreAnsichtAction } from "@/features/sperrliste/actions";
import { SPERRE_DAUER_HINWEIS, SPERRE_ERFOLG, SPERRE_PRESS, sperreOhneUebersicht } from "@/features/sperrliste/constants";
import { FLPostSperrlistePayloadSchema } from "@/features/sperrliste/schemas";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { Form } from "@/shared/components/ui/Form";
import { formButton, MODAL_FOOTER_CLASSES } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { skeletonBlock } from "@/shared/components/ui/skeleton";
import { TextField } from "@/shared/components/ui/TextField";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { rejectedWrite, unansweredRead } from "@/shared/utils/actionError";
import { appToast } from "@/shared/utils/appToast";

import { AdminSperreAnsichtList } from "../collections/AdminSperreAnsichtList";

import type { SperreAnsicht } from "@/features/sperrliste/actions";
import type { FLPostSperrlistePayload } from "@/features/sperrliste/schemas";

const EMPTY_DRAFT: FLPostSperrlistePayload = { email: "", grund: "" };

/** What the arming read left the reveal holding, carried WITH the address it was read for, which is the one the ban sends. */
type Gelesen = { adresse: string } & (
  { status: "reading" } | { status: "read"; ansicht: SperreAnsicht } | { status: "refused"; reason: string }
);

/** The armed reveal's body, in the three states the read leaves it in. */
function AnsichtBody({ gelesen }: { gelesen: Gelesen | null }) {
  if (gelesen?.status === "read") return <AdminSperreAnsichtList ansicht={gelesen.ansicht} />;
  if (gelesen?.status === "refused") {
    return <p className="fluid-xxs leading-normal font-medium text-foreground">{gelesen.reason}</p>;
  }

  // The app's one „not yet here“ treatment: what arrives is a list, so what stands in for it is shaped like one.
  return (
    <div
      aria-hidden="true"
      className="flex w-full flex-col gap-y-2">
      <span className={`${skeletonBlock()} h-3 w-40 rounded-md`} />
      <span className={`${skeletonBlock()} h-4 w-full rounded-md`} />
      <span className={`${skeletonBlock()} h-4 w-full rounded-md`} />
    </div>
  );
}

/**
 * The ban, its list read and shown before it, as the erasure's reveal is (`docs/frontend/spec.md :: I724`). **No
 * `onCreated` twin to the other create forms**: the row the API answers with holds no address to reassemble.
 */
export function AdminCreateSperreForm({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [draft, setDraft] = useState<FLPostSperrlistePayload>(EMPTY_DRAFT);
  const [gelesen, setGelesen] = useState<Gelesen | null>(null);
  // Only the latest arming's read answers, and only while the address box is unedited since: Next sends one client's
  // actions one at a time, so an earlier arming's answer lands while the latest waits.
  const letzteLesung = useRef(0);
  // The ban's armed press asks the passkey as its lift's does: the sign-out and the notice behind it are undone by nothing.
  const confirm = useTwoPressConfirm({ stepUp: true });
  const { isConfirming, isPending } = confirm;
  const { setSubmitFieldErrors, reportSubmitFailure, guardSubmit, useForgiveFixed, formWiring } = useDraftFieldErrors({
    schemas: { sperre: FLPostSperrlistePayloadSchema },
    failureTitle: SPERRE_PRESS.nichtGesperrt,
  });

  // Retracts a message the moment the value it judged becomes valid, as every create form does.
  useForgiveFixed({ sperre: draft });

  const lesen = async (gelesenFuer: FLPostSperrlistePayload) => {
    const lesung = ++letzteLesung.current;
    setGelesen({ adresse: gelesenFuer.email, status: "reading" });

    // Settled, never awaited bare: outside a transition a rejected action leaves the placeholder up and the press held.
    const [settled] = await Promise.allSettled([readSperreAnsichtAction({ email: gelesenFuer.email })]);
    if (lesung !== letzteLesung.current) return;
    const res = settled.status === "rejected" ? unansweredRead() : settled.value;

    if (res.success) {
      setGelesen({ adresse: gelesenFuer.email, status: "read", ansicht: res.ansicht });
      return;
    }

    // A refusal of the address, a grant holder's among them, lands on its box as the ban's would, the arming undone so
    // the next press reads the corrected address.
    if (res.fieldErrors?.email !== undefined) {
      setGelesen(null);
      confirm.cancel();
      reportSubmitFailure(res, { sperre: gelesenFuer });
      return;
    }

    setGelesen({ adresse: gelesenFuer.email, status: "refused", reason: sperreOhneUebersicht(res.unplacedError ?? res.error) });
  };

  const handlePress = () => {
    // The armed press sends the address its list was read for, never the box; the reason stays editable, so it is judged again.
    const gesendet = isConfirming && gelesen !== null ? { email: gelesen.adresse, grund: draft.grund } : draft;

    guardSubmit({ sperre: gesendet }, () => {
      if (!isConfirming) void lesen(gesendet);

      confirm.press(async () => {
        // A rejected action may still have saved, and uncaught here it takes the page down with it.
        const res = await postSperreAction(gesendet).catch(rejectedWrite(router));

        // Wrapped again: the press runs this inside its transition, and React leaves an update after an `await` outside it.
        startTransition(() => {
          if (!res.success) {
            reportSubmitFailure(res, { sperre: gesendet });
            return;
          }

          setSubmitFieldErrors({}, {});
          // The server's sentence as the body, never a second copy of the title (`docs/frontend/spec.md` §1.12). The
          // dialog closes, as every create's does: its list was worked through before the press.
          appToast.success(SPERRE_ERFOLG, { description: res.message === SPERRE_ERFOLG ? undefined : res.message });
          onClose();
        });
      });
    });
  };

  const ansicht = isConfirming ? gelesen : null;
  // The list IS what the press is confirmed over, so it is held over the placeholder and closed over a failed read: no
  // ban goes out over a list nobody saw (`docs/frontend/spec.md :: I724`).
  const isReading = isConfirming && (ansicht === null || ansicht.status === "reading");
  // A refused read alone names a reason of its own: one still running ends by itself, as the write does.
  const ansichtReason = !isPending && ansicht?.status === "refused" ? ansicht.reason : null;

  return (
    <Form
      wiring={formWiring}
      // Read by the unlayered rule in `globals.css` that keeps a create form's required asterisks.
      data-required-marks="on"
      className="flex h-fit w-full flex-col gap-y-6 rounded-xl shadow-sm"
      // Reached at rest alone, by the resting press or an Enter: once armed the press submits nothing.
      onSubmit={handlePress}>
      <div className="flex w-full flex-col gap-4 px-2">
        <TextField
          type="email"
          name="email"
          value={draft.email}
          isDisabled={isPending}
          // `value`/`onChange` belong on the field, not the inner `<Input>`: that is RAC's
          // controlled API, and on the input react-aria's field state never sees a value at all.
          onChange={(next) => {
            setDraft({ ...draft, email: next });
            // The arming and its read alike: the list, and a refusal of the box, speak of the address the box held before.
            letzteLesung.current += 1;
            confirm.cancel();
          }}>
          {/* „E-Mail“, as every neighbouring admin form labels the field. */}
          <Label className={FIELD_LABEL_CLASSES}>E-Mail</Label>
          {/* A submitted `type=email` value enters the browser's own autofill store, where the
              address of somebody being banned has no business being kept. */}
          <Input
            autoComplete="off"
            placeholder="z.B. name@beispiel.de"
            className={FIELD_INPUT_CLASSES}
          />
          <FieldError className={FIELD_ERROR_CLASSES} />
          {/* Both halves of what the ban does to the person at this address: it lapses by itself, and an account's
              holder is told at once. Neither is undoable from the list afterwards. */}
          <Hint
            mode="field"
            text={SPERRE_DAUER_HINWEIS}
          />
        </TextField>

        <TextField
          name="grund"
          value={draft.grund}
          isDisabled={isPending}
          onChange={(next) => setDraft({ ...draft, grund: next })}>
          <Label className={FIELD_LABEL_CLASSES}>Grund</Label>
          <Input
            placeholder="z.B. falsches Geburtsdatum angegeben"
            className={FIELD_INPUT_CLASSES}
          />
          <FieldError className={FIELD_ERROR_CLASSES} />
          {/* The row is served back, copied into a removal's log image and kept past the person's
              erasure, so a name typed here outlives every record the erasure was meant to end. */}
          <Hint
            mode="field"
            text="Nenne hier keine Person beim Namen. Die Sperre bleibt bestehen, auch wenn die Daten der Person gelöscht werden."
          />
        </TextField>

        {isConfirming && (
          <ConfirmReveal>
            <AnsichtBody gelesen={ansicht} />
          </ConfirmReveal>
        )}
      </div>

      {/* The separator reaches the dialog's edges rather than the form's; `MODAL_FOOTER_CLASSES` owns the arithmetic. */}
      <div className={MODAL_FOOTER_CLASSES}>
        <ConfirmActionRow confirm={confirm}>
          <ConfirmPressButton
            confirm={confirm}
            // The arming read holds the press without being the write: „Sperrt...“ is said for the ban alone.
            held={isReading}
            reason={ansichtReason}
            resting={SPERRE_PRESS.resting}
            armed={SPERRE_PRESS.armed}
            running={SPERRE_PRESS.running}
            icon={
              <Ban
                className="size-4.5"
                aria-hidden="true"
              />
            }
            // The form's submit at rest, so an Enter reads the list; a plain button once armed, so no Enter bans.
            type={isConfirming ? "button" : "submit"}
            onPress={isConfirming ? handlePress : undefined}
          />
          {/* The dialog's way back while nothing is armed; armed, the row's own cancel stands here and disarms. */}
          {!isConfirming && (
            <Button
              type="button"
              variant="secondary"
              className={formButton({ intent: "cancel", stacks: true })}
              onPress={onClose}>
              Abbrechen
            </Button>
          )}
        </ConfirmActionRow>
      </div>
    </Form>
  );
}
