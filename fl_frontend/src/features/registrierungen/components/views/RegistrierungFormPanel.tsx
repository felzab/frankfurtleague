"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import { Button } from "@heroui/react/button";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { TextField } from "@heroui/react/textfield";

import { BestaetigungErgebnis } from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { ClosedSetSelect } from "@/features/spieler/components/forms/ClosedSetSelect";
import { orderStufen } from "@/features/spieler/constants";
import { FLSpielerPositionSchema } from "@/features/spieler/schemas";
import { KONTAKT_NAME_MAX_LENGTH } from "@/features/teams/constants";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import {
  FIELD_ERROR_CLASSES,
  FIELD_INPUT_CLASSES,
  FIELD_LABEL_CLASSES,
  FIELD_PAIR_CLASSES,
  FORM_SECTION_HEADING_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
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
 * A second press is safe from this panel alone, which holds the key the first one carried
 * (`docs/frontend/spec.md :: I348`); unchanged, because other details under that key are refused.
 */
const REGISTRIERUNG_UNKLAR = "Schick die Registrierung hier unverändert noch einmal ab: Doppelt ankommen kann sie so nicht.";

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
  const [isPending, startSending] = useTransition();
  const [draft, setDraft] = useState<RegistrierungFormDraft>(buildEmptyDraft);
  /** One per attempt rather than per press: kept until a box carries a refusal, so the next press replays it (`docs/frontend/spec.md :: I348`). */
  const [schluessel, setSchluessel] = useState(() => crypto.randomUUID());
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

    startSending(async () => {
      const gesendet = await postPublicForm<RegistrierungAntwort>("/api/registrierung", payload, { idempotencyKey: schluessel });

      if (!gesendet.answered) {
        // No one title is true across both, the edge refusing the REQUEST ruling the write out where
        // an unread answer does not (`fl_frontend/src/shared/utils/publicSubmit.ts :: PublicAnswer`).
        appToast.danger(gesendet.wroteNothing ? "Registrierung nicht abgeschickt" : "Unklar, ob es bei uns angekommen ist", {
          // Every arm that may have landed gives the one step the outcome-unknown answer gives.
          description: gesendet.wroteNothing ? gesendet.error : REGISTRIERUNG_UNKLAR,
        });
        return;
      }

      const antwort = gesendet.body;

      // Wrapped again: React leaves an update after an `await` outside the transition that awaited,
      // so bare it commits before the pending state lifts.
      startSending(() => {
        if (!antwort.success) {
          // Titled as an unread answer is: the envelope's own sentence is an administrator's repair.
          if (antwort.outcome === "unknown") {
            appToast.danger("Unklar, ob es bei uns angekommen ist", { description: REGISTRIERUNG_UNKLAR });
            return;
          }

          // Renewed only where a box carries the judgement: the row whose mail was refused is stored, so
          // the corrected address is a new registration. A sentence alone keeps its replay
          // (`docs/frontend/spec.md :: I348`).
          if (antwort.fieldErrors !== undefined || antwort.unplacedError !== undefined) setSchluessel(crypto.randomUUID());

          // The invite died between the open and the press: the answer is the whole page, never a toast.
          if (antwort.zustand !== undefined) {
            onLinkTot();
            return;
          }

          // The hook owns the press's one toast: none where a field shows the refusal.
          reportSubmitFailure(
            {
              success: false,
              error: antwort.error ?? NICHT_ABGESCHICKT,
              fieldErrors: antwort.fieldErrors,
              unplacedError: antwort.unplacedError,
            },
            { registrierung: payload },
            {
              raise: (shown) =>
                appToast.failure(
                  antwort.schonAngekommen === true ? "Registrierung schon angekommen" : "Registrierung nicht abgeschickt",
                  shown,
                ),
            },
          );
          return;
        }

        setSubmitFieldErrors({}, {});
        setIsEingereicht(true);
      });
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
          <div className={FIELD_PAIR_CLASSES}>
            <TextField
              isRequired
              name="vorname"
              value={draft.vorname}
              onChange={(next) => setDraft({ ...draft, vorname: next })}
              onBlur={() => validateFields(["vorname"])}
              maxLength={KONTAKT_NAME_MAX_LENGTH}>
              <Label className={FIELD_LABEL_CLASSES}>Vorname</Label>
              <Input className={FIELD_INPUT_CLASSES} />
              <FieldError className={FIELD_ERROR_CLASSES} />
            </TextField>

            <TextField
              isRequired
              name="nachname"
              value={draft.nachname}
              onChange={(next) => setDraft({ ...draft, nachname: next })}
              onBlur={() => validateFields(["nachname"])}
              maxLength={KONTAKT_NAME_MAX_LENGTH}>
              <Label className={FIELD_LABEL_CLASSES}>Nachname</Label>
              <Input className={FIELD_INPUT_CLASSES} />
              <FieldError className={FIELD_ERROR_CLASSES} />
            </TextField>
          </div>

          <div className={FIELD_PAIR_CLASSES}>
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
                <Label className={FIELD_LABEL_CLASSES}>E-Mail</Label>
                <Input
                  placeholder="z.B. name@beispiel.de"
                  className={FIELD_INPUT_CLASSES}
                />
                <FieldError className={FIELD_ERROR_CLASSES} />
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
              <Label className={FIELD_LABEL_CLASSES}>Rückennummer</Label>
              <Input
                placeholder="z.B. 7"
                className={FIELD_INPUT_CLASSES}
              />
              <FieldError className={FIELD_ERROR_CLASSES} />
            </TextField>
          </div>

          <section className="flex flex-col gap-y-3">
            <h3 className={FORM_SECTION_HEADING_CLASSES}>Freiwillig</h3>
            <div className={FIELD_PAIR_CLASSES}>
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
