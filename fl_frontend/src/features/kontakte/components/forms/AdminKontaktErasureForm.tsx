"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { TrashBin } from "@gravity-ui/icons";

import { Button, FieldError, Form, Input, Label, TextField } from "@heroui/react";

import { eraseKontaktpersonAction } from "@/features/kontakte/actions";
import { FLKontaktErasurePayloadSchema } from "@/features/kontakte/schemas";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmReadoutRow } from "@/shared/components/ui/ConfirmReadoutRow";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { confirmButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { Hint } from "@/shared/components/ui/Hint";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { hasFieldErrors } from "@/shared/hooks/useServerFieldErrors";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

/**
 * A contact person's erasure, on `POST /kontakte/erasure`. A confirmation step and no undo.
 *
 * A panel and not a row control: the press is keyed on the ADDRESS across every season and both
 * collections, which no row of this page stands for.
 */
export function AdminKontaktErasureForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");

  // Judged when the field is LEFT and never between keystrokes: a message about a half-typed address
  // describes a value nobody finished entering.
  const { fieldErrors, setSubmitFieldErrors, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { erasure: FLKontaktErasurePayloadSchema },
  });

  // Forgiveness runs on every draft change and only ever RETRACTS: a corrected address clears without a blur.
  useForgiveFixed({ erasure: { email } });

  /**
   * Runs before arming AND before writing, and is the shared block rather than a second spelling of it: a
   * refused address is published through the map that moves focus, so the press lands the caret on the box.
   */
  const judgeAddress = (): boolean => {
    let mayWrite = false;
    guardSubmit({ erasure: { email } }, () => {
      mayWrite = true;
    });

    return mayWrite;
  };

  const { isConfirming, isPending: isErasing, press, cancel } = useTwoPressConfirm(judgeAddress);

  const panel = formPanel({ tone: "danger" });

  const handleAddressChange = (next: string) => {
    setEmail(next);
    // Disarms, as the draw's panel disarms when the operation on offer changes: the reveal below
    // names one address, and what the press sends may never be an address nobody read there.
    if (isConfirming) cancel();
  };

  /** The write itself. Reached only through `press`, and only on an armed second press. */
  const commit = async () => {
    const res = await eraseKontaktpersonAction({ email });

    if (!res.success) {
      if (hasFieldErrors(res.fieldErrors)) setSubmitFieldErrors(res.fieldErrors, { erasure: { email } });
      appToast.danger("Kontaktperson nicht gelöscht", { description: res.error ?? UNKNOWN_REFUSAL });
      return;
    }

    /* An address matching nobody succeeds and clears zero, and „gelöscht“ over that is a quiet lie.
       The branch `FormKontaktErasure` takes, so one erasure is not reported two ways. */
    if (res.cleared === 0) appToast.warning("Nichts gefunden", { description: res.message });
    else appToast.success("Kontaktperson gelöscht", { description: res.message });
    // The address goes with the records it named. On screen it is a copy of what the press destroyed.
    setEmail("");
    // The list above is read per request rather than from a cache, so this lands the cleared rows.
    router.refresh();
  };

  const handleErase = () => press(commit);

  /**
   * The form's submit ARMS and never commits. Return auto-repeats while the hands are still in the
   * field, so a held key would deliver both presses of the confirm behind one decision.
   */
  const handleArm = () => {
    if (!isConfirming) press(commit);
  };

  return (
    <section className={panel.root()}>
      <div className={panel.header()}>
        <h2 className={panel.heading()}>
          Kontaktperson löschen
          {/* What goes and what survives is the panel's own body below, and the danger panel with its
              two-press control is what says the press is final. */}
          <Hint
            mode="reveal"
            label="Hinweis zum Löschen einer Kontaktperson"
            body={{
              lead: "Der Weg, eine Kontaktperson ganz aus der Verwaltung zu entfernen.",
              points: [
                {
                  term: "Die Felder beim Team zu leeren",
                  text: "ist etwas anderes: Die alten Angaben bleiben im Änderungsprotokoll.",
                },
              ],
            }}
          />
        </h2>
      </div>

      {/* `runOnSubmit` rather than an `action`, which React resets on every submit, turning each
          controlled field's reset into an `onChange` (frontend spec I32). */}
      <Form
        // Missing belongs to the submit, not to a blur: `native` commits on every DOM `change`, painting
        // the browser's required message the moment an edited field is cleared. `aria` keeps
        // `aria-required` and leaves every message to `useDraftFieldErrors`.
        validationBehavior="aria"
        ref={formRef}
        validationErrors={fieldErrors}
        className={panel.body()}
        onSubmit={runOnSubmit(handleArm)}>
        <p className="muted-hint">
          Das Löschen leert jeden Kontakteintrag mit dieser E-Mail-Adresse, in jeder Saison und in jeder Bewerbung. Im Änderungsprotokoll wird
          dazu der gesicherte Stand jeder Zeile gelöscht, die eine dieser Saison-Zugehörigkeiten oder Bewerbungen betrifft. Das gilt auch für
          Zeilen, in denen es um etwas ganz anderes ging, etwa um eine Trikotfarbe oder einen Gruppenwechsel. Was wann geschehen ist, bleibt
          lesbar. Die anderen Kontaktpersonen beim selben Team bleiben eingetragen.
        </p>

        {/* `name` is the payload's own path: react-aria looks a server error up as
            `validationErrors[name]`, so the two halves meet with no translation table. */}
        <TextField
          type="email"
          name="email"
          value={email}
          onChange={handleAddressChange}
          onBlur={() => validatePaths("erasure", { email }, ["email"])}>
          <Label className={FIELD_LABEL}>E-Mail-Adresse</Label>
          <Input
            placeholder="z.B. trainer@beispielschule.de"
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR} />
        </TextField>

        {isConfirming && (
          <ConfirmReveal>
            <div className="flex w-full flex-col gap-y-1">
              <h3 className={FORM_SECTION_HEADING}>Was dabei gelöscht wird</h3>
              <dl className="flex w-full flex-col gap-y-1">
                <ConfirmReadoutRow
                  label="E-Mail-Adresse"
                  value={email}
                />
                <ConfirmReadoutRow
                  label="Kontakteinträge"
                  value="In allen Saisons und Bewerbungen"
                />
                {/* The log's own words for the image it keeps, so the readout names what a row loses
                    rather than a subset of it: the redaction clears the WHOLE stand. */}
                <ConfirmReadoutRow
                  label="Änderungsprotokoll"
                  value="Gesicherter Stand wird gelöscht"
                />
              </dl>
            </div>

            {/* No restore is named on purpose: nothing holds the old values once the slots and the log
                rows are both cleared. The reassurance is qualified here rather than in the body alone,
                this being the last thing read before the press. */}
            <p className="fluid-xxs text-foreground leading-normal font-medium">
              Zurückholen lässt sich das nicht. Das Team und die Saison bleiben bestehen, und im Änderungsprotokoll bleibt jede Zeile lesbar.
              Die anderen Kontaktpersonen bleiben eingetragen. Ihr gesicherter Stand im Änderungsprotokoll geht aber mit.
            </p>
          </ConfirmReveal>
        )}

        <ConfirmActionRow
          isConfirming={isConfirming}
          isPending={isErasing}
          onCancel={cancel}>
          {/* `type="button"`, as every other two-press control in the app is: as a submit it would take
              the Return key's auto-repeat as the second press. */}
          <Button
            type="button"
            variant="primary"
            isDisabled={isErasing}
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
                löschen“ reads as the team going, which is the one thing this control does not touch. */}
            {isErasing ? "Löscht..." : isConfirming ? "Ja, Kontaktperson endgültig löschen" : "Kontaktperson löschen"}
          </Button>
        </ConfirmActionRow>
      </Form>
    </section>
  );
}
