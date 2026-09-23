"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Button, FieldError, Form, Input, Label, TextField } from "@heroui/react";

import { BestaetigungErgebnis } from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { ClosedSetSelect } from "@/features/spieler/components/forms/ClosedSetSelect";
import { orderStufen } from "@/features/spieler/constants";
import { FLSpielerPositionSchema } from "@/features/spieler/schemas";
import { KONTAKT_NAME_MAX_LENGTH } from "@/features/teams/constants";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL, FIELD_PAIR, FORM_SECTION_HEADING } from "@/shared/components/ui/formFieldStyles";
import { formPanel } from "@/shared/components/ui/formPanel";
import { runOnSubmit } from "@/shared/components/ui/formSubmit";
import { Hint } from "@/shared/components/ui/Hint";
import { PanelHeading } from "@/shared/components/ui/PanelHeading";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { postPublicForm } from "@/shared/utils/publicSubmit";

import { REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE } from "../../constants";
import { FLPostRegistrierungPayloadSchema } from "../../schemas";
import { registrierungPayload } from "../../utils";

import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { FLEinladungAnsichtResponse } from "../../schemas";
import type { RegistrierungFormDraft } from "../../types";

type RegistrierungAntwort = { success: true } | (PublicEnvelope & { success: false; zustand?: "ungueltig" });

const NICHT_ABGESCHICKT = "Deine Registrierung wurde nicht gespeichert. Versuche es erneut.";

/**
 * A second press is the repair where the first may have landed, the write refusing nothing on the
 * strength of a pending row; the first, never confirmed, lapses on the registration clock.
 */
const REGISTRIERUNG_UNKLAR =
  "Schick die Registrierung noch einmal ab. Ist die erste doch angekommen, löscht sie sich ohne Bestätigung nach " +
  `${String(REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)} Tagen von selbst.`;

const POSITION_OPTIONS = FLSpielerPositionSchema.options;

const buildEmptyDraft = (): RegistrierungFormDraft => ({ vorname: "", nachname: "", email: "", nummer: "", position: null, stufe: null });

/**
 * The registration form the invite opens.
 *
 * The Stufe picker is built from the invite's own `erlaubte_stufen`, never the league's whole set:
 * a select offering what the write refuses hands a pupil that refusal at the press.
 */
export function RegistrierungFormPanel({
  token,
  ansicht,
  onLinkTot,
}: {
  token: string;
  ansicht: FLEinladungAnsichtResponse;
  /** Raised where the write found the invite gone, which is the whole page's answer rather than this panel's. */
  onLinkTot: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<RegistrierungFormDraft>(buildEmptyDraft);
  const [isEingereicht, setIsEingereicht] = useState(false);

  const emailHinweisId = useId();
  const eingereichtRef = useRef<HTMLElement>(null);

  const { fieldErrors, setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formRef } = useDraftFieldErrors({
    schemas: { registrierung: FLPostRegistrierungPayloadSchema },
    // This page's own word for the failure: „Änderung nicht gespeichert“ names a change nobody here
    // made, and two titles for one failure read as two failures.
    failureTitle: "Registrierung nicht abgeschickt",
  });

  // Above the „eingereicht“ return, as every hook here is: a hook called only on the way to the panel
  // would run a different number of times per render.
  useForgiveFixed({ registrierung: registrierungPayload(draft, token) });

  useEffect(() => {
    if (isEingereicht) eingereichtRef.current?.focus();
  }, [isEingereicht]);

  const validateFields = (paths: readonly string[]) => validatePaths("registrierung", registrierungPayload(draft, token), paths);

  const writeAfterBlock = () => {
    const payload = registrierungPayload(draft, token);

    startTransition(async () => {
      const gesendet = await postPublicForm<RegistrierungAntwort>("/api/registrierung", payload);

      if (!gesendet.answered) {
        // No one title is true across both, the edge refusing the REQUEST ruling the write out where
        // an unread answer does not (`fl_frontend/src/shared/utils/publicSubmit.ts :: PublicAnswer`).
        appToast.danger(gesendet.wroteNothing ? "Registrierung nicht abgeschickt" : "Unklar, ob es bei uns angekommen ist", {
          description: gesendet.error,
        });
        return;
      }

      const antwort = gesendet.body;

      if (!antwort.success) {
        // Titled as an unread answer is: the envelope's own sentence is an administrator's repair.
        if (antwort.outcome === "unknown") {
          appToast.danger("Unklar, ob es bei uns angekommen ist", { description: REGISTRIERUNG_UNKLAR });
          return;
        }

        // The invite died between the open and the press: the answer is the whole page, never a toast.
        if (antwort.zustand !== undefined) {
          onLinkTot();
          return;
        }

        // The hook owns the press's one toast: none where a field shows the refusal.
        reportSubmitFailure(
          { success: false, error: antwort.error ?? NICHT_ABGESCHICKT, fieldErrors: antwort.fieldErrors, unplacedError: antwort.unplacedError },
          { registrierung: payload },
          {
            raise: (shown) => appToast.failure("Registrierung nicht abgeschickt", shown),
          },
        );
        return;
      }

      setSubmitFieldErrors({}, {});
      setIsEingereicht(true);
    });
  };

  if (isEingereicht) {
    return (
      <BestaetigungErgebnis
        panelRef={eingereichtRef}
        tone="erfolg">
        <h2 className="fluid-lg text-foreground font-extrabold tracking-tight">Deine Registrierung ist eingegangen</h2>
        {/* The recovery path in the answer page's own words: no administrator may edit a stored
            address, so registering again is the only route back from a typo. */}
        <p className="muted-hint max-w-md">
          Wir haben Dir eine E-Mail mit einem Link geschickt. Erst wenn Du dort bestätigst, kann Dein Team Dich in den Kader aufnehmen.
          Bestätigst Du nicht innerhalb von {String(REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)} Tagen, löschen wir die Registrierung wieder. Keine
          Mail bekommen? Prüfe die Adresse und registriere Dich einfach noch einmal.
        </p>
      </BestaetigungErgebnis>
    );
  }

  const panel = formPanel();

  return (
    <Form
      ref={formRef}
      // `aria`, never `native`: missing belongs to the submit, not a blur (`docs/frontend/spec.md :: I40`, `:: I71`).
      validationBehavior="aria"
      data-required-marks="on"
      validationErrors={fieldErrors}
      className="flex w-full flex-col gap-6"
      onSubmit={runOnSubmit(() => {
        // The block keeping an incomplete draft off the wire; it RUNS the write (`docs/frontend/spec.md :: I71`).
        guardSubmit({ registrierung: registrierungPayload(draft, token) }, writeAfterBlock);
      })}>
      <section className={panel.root()}>
        <div className={panel.header()}>
          <PanelHeading
            className={panel.heading()}
            title="Deine Angaben"
          />
        </div>

        <div className={panel.body()}>
          <div className={FIELD_PAIR}>
            <TextField
              isRequired
              name="vorname"
              value={draft.vorname}
              onChange={(next) => setDraft({ ...draft, vorname: next })}
              onBlur={() => validateFields(["vorname"])}
              maxLength={KONTAKT_NAME_MAX_LENGTH}>
              <Label className={FIELD_LABEL}>Vorname</Label>
              <Input className={FIELD_INPUT} />
              <FieldError className={FIELD_ERROR} />
            </TextField>

            <TextField
              isRequired
              name="nachname"
              value={draft.nachname}
              onChange={(next) => setDraft({ ...draft, nachname: next })}
              onBlur={() => validateFields(["nachname"])}
              maxLength={KONTAKT_NAME_MAX_LENGTH}>
              <Label className={FIELD_LABEL}>Nachname</Label>
              <Input className={FIELD_INPUT} />
              <FieldError className={FIELD_ERROR} />
            </TextField>
          </div>

          <div className={FIELD_PAIR}>
            {/* The hint rides in the same grid cell as the box it explains, so it stays under that box
                rather than under whichever field the two-column layout puts beside it. */}
            <div className="flex w-full flex-col gap-y-1">
              <TextField
                isRequired
                type="email"
                aria-describedby={emailHinweisId}
                name="email"
                value={draft.email}
                onChange={(next) => setDraft({ ...draft, email: next })}
                onBlur={() => validateFields(["email"])}>
                <Label className={FIELD_LABEL}>E-Mail</Label>
                <Input
                  placeholder="z.B. name@beispiel.de"
                  className={FIELD_INPUT}
                />
                <FieldError className={FIELD_ERROR} />
              </TextField>
              <Hint
                mode="inline"
                describes={emailHinweisId}
                text="An diese Adresse schicken wir Deinen Bestätigungslink. Sie wird später auch Dein Zugang zur Website."
              />
            </div>

            <TextField
              name="nummer"
              inputMode="numeric"
              value={draft.nummer}
              onChange={(next) => setDraft({ ...draft, nummer: next })}
              onBlur={() => validateFields(["nummer"])}>
              <Label className={FIELD_LABEL}>Rückennummer</Label>
              <Input
                placeholder="z.B. 7"
                className={FIELD_INPUT}
              />
              <FieldError className={FIELD_ERROR} />
            </TextField>
          </div>

          <section className="flex flex-col gap-y-3">
            <h3 className={FORM_SECTION_HEADING}>Freiwillig</h3>
            <div className={FIELD_PAIR}>
              <ClosedSetSelect
                name="position"
                label="Position"
                placeholder="Keine Angabe"
                options={POSITION_OPTIONS}
                value={draft.position}
                onChange={(position) => setDraft({ ...draft, position: position })}
              />

              {/* The season's own set, never `STUFE_OPTIONS`: `orderStufen` is what puts the invite's
                  answer back into the league's order after the read narrowed it. */}
              <ClosedSetSelect
                name="stufe"
                label="Stufe"
                placeholder="Keine Angabe"
                options={orderStufen(ansicht.erlaubte_stufen)}
                value={draft.stufe}
                onChange={(stufe) => setDraft({ ...draft, stufe: stufe })}
              />
            </div>
          </section>
        </div>
      </section>

      <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:justify-end">
        <Button
          type="submit"
          isPending={isPending}
          className={formButton({ intent: "submit", fullWidth: true })}>
          {isPending ? "Schickt ab..." : "Registrierung abschicken"}
        </Button>
      </div>
    </Form>
  );
}
