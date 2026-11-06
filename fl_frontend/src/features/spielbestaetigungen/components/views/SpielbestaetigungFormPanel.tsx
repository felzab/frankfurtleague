"use client";

import { startTransition, useState, useTransition } from "react";

import ChevronsDownWide from "@gravity-ui/icons/ChevronsDownWide";
import CircleCheck from "@gravity-ui/icons/CircleCheck";
import { parseDate, parseTime } from "@internationalized/date";

import { Button } from "@heroui/react/button";
import { Disclosure } from "@heroui/react/disclosure";
import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { PARAGRAPH_CLASSES } from "@/features/bewerbungen/components/ui/Gefuellt";
import { ANSWER_NOT_SAVED, ANSWER_NOT_SAVED_SENTENCE, ConfirmationSection } from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { FLSpielbestaetigungAnswerPayloadSchema } from "@/features/spielbestaetigungen/schemas";
import { SPIELBESTAETIGUNG_REASON_MAX_LENGTH } from "@/features/spiele/constants";
import { ConfirmActionRow } from "@/shared/components/ui/ConfirmActionRow";
import { ConfirmPressButton } from "@/shared/components/ui/ConfirmPressButton";
import { ConfirmReveal } from "@/shared/components/ui/ConfirmReveal";
import { AppDatePicker, AppTimeField } from "@/shared/components/ui/DateTimeFields";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES, FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { TextField } from "@/shared/components/ui/TextField";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";
import { reportRefusedConfirmation } from "@/shared/utils/linkConfirmation";
import { postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";

import type { FLSpielbestaetigungAnswerKind, FLSpielbestaetigungAppointment, FLSpielbestaetigungBy } from "@/core/generated/client/types";
import type { FLSpielbestaetigungAnswerPayload } from "@/features/spielbestaetigungen/schemas";
import type { SpielbestaetigungLinkZustand } from "@/features/spielbestaetigungen/utils";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { CalendarDate, Time } from "@internationalized/date";

/** The disclosure's trigger, which the view's sheet presses by these words. */
const ANDEREN_TERMIN_VORSCHLAGEN = "Anderen Termin vorschlagen";

/** What one press ends in, handed up to the page that swaps the form for the panel. */
export type SpielbestaetigungAbschluss =
  | { state: "zugesagt-neu" }
  | { state: "abgelehnt-neu"; vorschlag: FLSpielbestaetigungAppointment }
  | { state: "zugesagt"; answered_by: FLSpielbestaetigungBy }
  | { state: "declined"; answered_by: FLSpielbestaetigungBy }
  | { state: "discarded"; appointment: FLSpielbestaetigungAppointment }
  | { state: Exclude<SpielbestaetigungLinkZustand, "zugesagt" | "declined" | "discarded"> };

/** The route's answer: the echo of what was stored, or a refusal naming the link's state where the link died. */
export type SpielbestaetigungAnswer =
  | { success: true; state: FLSpielbestaetigungAnswerKind; vorschlag: FLSpielbestaetigungAppointment | null }
  | (PublicEnvelope & {
      success: false;
      state?: SpielbestaetigungLinkZustand;
      answered_by?: FLSpielbestaetigungBy;
      appointment?: FLSpielbestaetigungAppointment;
    });

/** The proposal mid-entry: `""` is a box nobody filled in, which the payload's schema then refuses. */
type Entwurf = { date: string; time: string; reason: string };

const LEERER_ENTWURF: Entwurf = { date: "", time: "", reason: "" };

/** A Zusage carries nothing but the token: both keys are sent null rather than left out, as the endpoint requires them. */
const zusagePayload = (token: string): FLSpielbestaetigungAnswerPayload => ({
  token,
  answer: "zugesagt",
  vorschlag: null,
  reason: null,
});

/** A proposal declines the date standing: the endpoint takes no decline without one. */
const vorschlagPayload = (token: string, entwurf: Entwurf): FLSpielbestaetigungAnswerPayload => ({
  token,
  answer: "declined",
  vorschlag: { date: entwurf.date, time: entwurf.time },
  // An empty box is no reason, as the endpoint reads one.
  reason: entwurf.reason.trim() === "" ? null : entwurf.reason,
});

const toCalendarDate = (stored: string): CalendarDate | null => (stored === "" ? null : parseDate(stored));
const toTime = (stored: string): Time | null => (stored === "" ? null : parseTime(stored));

/** A refused press as the panel it swaps the form for: an answered link keeps the seat that answered. */
function spentAbschluss(
  state: SpielbestaetigungLinkZustand,
  answeredBy: FLSpielbestaetigungBy | undefined,
  appointment: FLSpielbestaetigungAppointment | undefined,
): SpielbestaetigungAbschluss {
  // As an answered state without its seat: a discard read back without the date it kept claims nothing either.
  if (state === "discarded") return appointment === undefined ? { state: "invalid" } : { state, appointment };
  if (state !== "zugesagt" && state !== "declined") return { state };
  // A route answering an answered state without its seat is the dead-link panel's: claiming nothing about who answered.
  return answeredBy === undefined ? { state: "invalid" } : { state, answered_by: answeredBy };
}

/**
 * The club's answer: a Zusage armed by its first press and sent by its second, or a proposed date behind
 * the disclosure. **Both are one write each**, the first answer of any of the club's seats binding the club.
 */
export function SpielbestaetigungFormPanel({
  token,
  onAbschluss,
}: {
  token: string;
  onAbschluss: (abschluss: SpielbestaetigungAbschluss) => void;
}) {
  const zusage = useTwoPressConfirm();
  const [isSendingVorschlag, startSendingVorschlag] = useTransition();
  const [entwurf, setEntwurf] = useState<Entwurf>(LEERER_ENTWURF);

  // The payload the write is judged by, judging the draft too: a second schema here would be the page
  // refusing at rules the endpoint does not, on the day the two disagree.
  const { setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formWiring } = useDraftFieldErrors({
    schemas: { answer: FLSpielbestaetigungAnswerPayloadSchema },
    failureTitle: ANSWER_NOT_SAVED,
  });

  useForgiveFixed({ answer: vorschlagPayload(token, entwurf) });

  const left = (paths: readonly string[]) => validatePaths("answer", vorschlagPayload(token, entwurf), paths);

  const sende = async (payload: FLSpielbestaetigungAnswerPayload): Promise<void> => {
    const sent = await postPublicForm<SpielbestaetigungAnswer>("/api/bestaetigung/spiel", payload);

    if (!sent.answered) {
      // No one title is true across both, the edge refusing the REQUEST ruling the write out where an
      // unread answer does not (`fl_frontend/src/shared/utils/publicSubmit.ts :: PublicAnswer`).
      appToast.danger(sent.wroteNothing ? ANSWER_NOT_SAVED : UNKLAR_TITEL, { description: sent.error });
      return;
    }

    const response = sent.body;

    // Wrapped again: React leaves an update after an `await` outside the transition that awaited.
    startTransition(() => {
      if (!response.success) {
        reportRefusedConfirmation(response, {
          onState: (state) => onAbschluss(spentAbschluss(state, response.answered_by, response.appointment)),
          // The hook owns the press's one toast: none where a box shows the refusal.
          onRefusal: () =>
            reportSubmitFailure(
              {
                success: false,
                error: response.error ?? ANSWER_NOT_SAVED_SENTENCE,
                fieldErrors: response.fieldErrors,
                unplacedError: response.unplacedError,
              },
              { answer: payload },
              { raise: (shown) => appToast.failure(ANSWER_NOT_SAVED, shown) },
            ),
        });
        return;
      }

      setSubmitFieldErrors({}, {});
      // A stored decline always carries its proposal; one answered without it reads as the Zusage it cannot be.
      if (response.state === "declined" && response.vorschlag !== null) {
        onAbschluss({ state: "abgelehnt-neu", vorschlag: response.vorschlag });
        return;
      }
      onAbschluss(response.state === "zugesagt" ? { state: "zugesagt-neu" } : { state: "invalid" });
    });
  };

  // Judged on both presses, as the hook's own guard is: the arming one never arms a payload the endpoint would refuse.
  const sendeZusage = () => {
    const payload = zusagePayload(token);
    guardSubmit({ answer: payload }, () => {
      zusage.press(() => sende(payload));
    });
  };

  // The form's own submit is the proposal's, so an Enter in one of its boxes never sends a Zusage.
  const sendeVorschlag = () => {
    const payload = vorschlagPayload(token, entwurf);
    guardSubmit({ answer: payload }, () => {
      startSendingVorschlag(async () => {
        await sende(payload);
      });
    });
  };

  return (
    <Form
      wiring={formWiring}
      data-required-marks="on"
      className="flex w-full flex-col gap-6"
      onSubmit={sendeVorschlag}>
      <ConfirmationSection titel="Deine Antwort">
        <ConfirmActionRow confirm={zusage}>
          <ConfirmPressButton
            confirm={zusage}
            // Held, never relabelled, while the proposal is sending: both wait on the one write in flight.
            held={isSendingVorschlag}
            reason={null}
            resting="Zusagen"
            armed="Ja, zusagen"
            running="Sagt zu..."
            icon={
              <CircleCheck
                className="size-4.5"
                aria-hidden="true"
              />
            }
            onPress={sendeZusage}
          />
        </ConfirmActionRow>

        {zusage.isConfirming && (
          <ConfirmReveal>
            <p className="fluid-sm text-pretty text-foreground">
              Du bestätigst den Termin für Dein Team. Das lässt sich hier nicht rückgängig machen.
            </p>
          </ConfirmReveal>
        )}

        <div
          // Hidden while the Zusage is armed, as the referee's decline is: the page arms one answer at a time.
          hidden={zusage.isConfirming}>
          <Disclosure>
            <Disclosure.Heading level={3}>
              <Disclosure.Trigger className="flex w-fit items-center gap-x-2 fluid-sm font-bold text-foreground">
                {ANDEREN_TERMIN_VORSCHLAGEN}
                <Disclosure.Indicator className="shrink-0 text-foreground-muted">
                  <ChevronsDownWide
                    aria-hidden="true"
                    className="size-5"
                  />
                </Disclosure.Indicator>
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <Disclosure.Body className="flex flex-col gap-y-4 pt-3">
                {/* The one thing a reader gets wrong here: a proposal is the club's answer, not a question beside it. */}
                <p className={PARAGRAPH_CLASSES}>
                  Mit einem Vorschlag sagst Du den Termin oben ab. Über den neuen Termin entscheidet die Liga.
                </p>

                <div className={FIELD_PAIR_CLASSES}>
                  <AppDatePicker
                    name="vorschlag.date"
                    label={<Label className={FIELD_LABEL_CLASSES}>Neues Datum</Label>}
                    calendarLabel="Neues Datum auswählen"
                    value={toCalendarDate(entwurf.date)}
                    onChange={(next) => setEntwurf({ ...entwurf, date: next?.toString() ?? "" })}
                    onBlur={() => left(["vorschlag.date"])}
                    // The calendar alone: the endpoint judges a past date, and the field marks a half-typed one otherwise.
                    minValue={parseDate(getGermanTodayStr())}
                  />
                  <AppTimeField
                    name="vorschlag.time"
                    label={<Label className={FIELD_LABEL_CLASSES}>Neuer Anpfiff</Label>}
                    value={toTime(entwurf.time)}
                    onChange={(next) => setEntwurf({ ...entwurf, time: next?.toString() ?? "" })}
                    onBlur={() => left(["vorschlag.time"])}
                  />
                </div>

                {/* One line, as the endpoint stores it: a line break is refused rather than kept. */}
                <TextField
                  name="reason"
                  value={entwurf.reason}
                  onChange={(next) => setEntwurf({ ...entwurf, reason: next })}
                  onBlur={() => left(["reason"])}
                  maxLength={SPIELBESTAETIGUNG_REASON_MAX_LENGTH}>
                  <Label className={FIELD_LABEL_CLASSES}>Begründung</Label>
                  <Input className={FIELD_INPUT_CLASSES} />
                  <FieldError className={FIELD_ERROR_CLASSES} />
                  <Hint
                    mode="field"
                    text="Nur die Verwaltung der Liga liest sie. Nenne darin keine Namen."
                  />
                </TextField>

                <div className="flex w-full flex-col items-stretch sm:flex-row sm:justify-end">
                  <Button
                    type="submit"
                    isPending={isSendingVorschlag || zusage.isPending}
                    className={formButton({ intent: "submit", stacks: true })}>
                    {isSendingVorschlag ? "Sendet..." : "Vorschlag senden"}
                  </Button>
                </div>
              </Disclosure.Body>
            </Disclosure.Content>
          </Disclosure>
        </div>
      </ConfirmationSection>
    </Form>
  );
}
