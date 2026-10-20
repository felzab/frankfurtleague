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

import { ABSATZ_CLASSES } from "@/features/bewerbungen/components/ui/Gefuellt";
import {
  ANTWORT_NICHT_GESPEICHERT,
  ANTWORT_NICHT_GESPEICHERT_SATZ,
  BestaetigungAbschnitt,
} from "@/features/bewerbungen/components/views/BestaetigungPanels";
import { FLSpielbestaetigungAntwortPayloadSchema } from "@/features/spielbestaetigungen/schemas";
import { SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH } from "@/features/spiele/constants";
import { AppDatePicker, AppTimeField } from "@/shared/components/ui/DateTimeFields";
import { Form } from "@/shared/components/ui/Form";
import { formButton } from "@/shared/components/ui/formButtons";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES, FIELD_PAIR_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { TextField } from "@/shared/components/ui/TextField";
import { useDraftFieldErrors } from "@/shared/hooks/useDraftFieldErrors";
import { appToast } from "@/shared/utils/appToast";
import { getGermanTodayStr } from "@/shared/utils/date";
import { reportRefusedConfirmation } from "@/shared/utils/linkConfirmation";
import { postPublicForm, UNKLAR_TITEL } from "@/shared/utils/publicSubmit";

import type {
  FLSpielbestaetigungAntwortPayload,
  FLSpielbestaetigungTermin,
  FLSpielbestaetigungVon,
} from "@/features/spielbestaetigungen/schemas";
import type { SpielbestaetigungLinkZustand } from "@/features/spielbestaetigungen/utils";
import type { PublicEnvelope } from "@/shared/utils/publicSubmit";
import type { CalendarDate, Time } from "@internationalized/date";

/** The disclosure's trigger, which the view's sheet presses by these words. */
export const ANDEREN_TERMIN_VORSCHLAGEN = "Anderen Termin vorschlagen";

/** What one press ends in, handed up to the page that swaps the form for the panel. */
export type SpielbestaetigungAbschluss =
  | { zustand: "zugesagt-neu" }
  | { zustand: "abgelehnt-neu"; vorschlag: FLSpielbestaetigungTermin }
  | { zustand: "zugesagt"; beantwortet_von: FLSpielbestaetigungVon }
  | { zustand: "abgelehnt"; beantwortet_von: FLSpielbestaetigungVon }
  | { zustand: Exclude<SpielbestaetigungLinkZustand, "zugesagt" | "abgelehnt"> };

/** The route's answer: the echo of what was stored, or a refusal naming the link's state where the link died. */
export type SpielbestaetigungAntwort =
  | { success: true; zustand: "zugesagt" | "abgelehnt"; vorschlag: FLSpielbestaetigungTermin | null }
  | (PublicEnvelope & { success: false; zustand?: SpielbestaetigungLinkZustand; beantwortet_von?: FLSpielbestaetigungVon });

/** The proposal mid-entry: `""` is a box nobody filled in, which the payload's schema then refuses. */
type Entwurf = { datum: string; uhrzeit: string; begruendung: string };

const LEERER_ENTWURF: Entwurf = { datum: "", uhrzeit: "", begruendung: "" };

/** A Zusage carries nothing but the token: both keys are sent null rather than left out, as the endpoint requires them. */
const zusagePayload = (token: string): FLSpielbestaetigungAntwortPayload => ({
  token: token,
  antwort: "zugesagt",
  vorschlag: null,
  begruendung: null,
});

/** A proposal declines the date standing: the endpoint takes no decline without one. */
const vorschlagPayload = (token: string, entwurf: Entwurf): FLSpielbestaetigungAntwortPayload => ({
  token: token,
  antwort: "abgelehnt",
  vorschlag: { datum: entwurf.datum, uhrzeit: entwurf.uhrzeit },
  // An empty box is no reason, as the endpoint reads one.
  begruendung: entwurf.begruendung.trim() === "" ? null : entwurf.begruendung,
});

const toCalendarDate = (stored: string): CalendarDate | null => (stored === "" ? null : parseDate(stored));
const toTime = (stored: string): Time | null => (stored === "" ? null : parseTime(stored));

/** A refused press as the panel it swaps the form for: an answered link keeps the seat that answered. */
function spentAbschluss(zustand: SpielbestaetigungLinkZustand, beantwortetVon: FLSpielbestaetigungVon | undefined): SpielbestaetigungAbschluss {
  if (zustand !== "zugesagt" && zustand !== "abgelehnt") return { zustand: zustand };
  // A route answering an answered state without its seat is the dead-link panel's: claiming nothing about who answered.
  return beantwortetVon === undefined ? { zustand: "ungueltig" } : { zustand: zustand, beantwortet_von: beantwortetVon };
}

/**
 * The club's answer: a Zusage in one press, or a proposed date behind the disclosure. **Both are one
 * write each**, the first press of any of the club's seats binding the club.
 */
export function SpielbestaetigungFormPanel({
  token,
  onAbschluss,
}: {
  token: string;
  onAbschluss: (abschluss: SpielbestaetigungAbschluss) => void;
}) {
  const [isPending, startSending] = useTransition();
  // Both presses wait on the one write, but only the one pressed reads as sending, as the other link pages' second press does.
  const [gedrueckt, setGedrueckt] = useState<"zusage" | "vorschlag">("zusage");
  const [entwurf, setEntwurf] = useState<Entwurf>(LEERER_ENTWURF);

  // The payload the write is judged by, judging the draft too: a second schema here would be the page
  // refusing at rules the endpoint does not, on the day the two disagree.
  const { setSubmitFieldErrors, reportSubmitFailure, guardSubmit, validatePaths, useForgiveFixed, formWiring } = useDraftFieldErrors({
    schemas: { antwort: FLSpielbestaetigungAntwortPayloadSchema },
    failureTitle: ANTWORT_NICHT_GESPEICHERT,
  });

  useForgiveFixed({ antwort: vorschlagPayload(token, entwurf) });

  const verlassen = (paths: readonly string[]) => validatePaths("antwort", vorschlagPayload(token, entwurf), paths);

  const sende = async (payload: FLSpielbestaetigungAntwortPayload): Promise<void> => {
    const gesendet = await postPublicForm<SpielbestaetigungAntwort>("/api/bestaetigung/spiel", payload);

    if (!gesendet.answered) {
      // No one title is true across both, the edge refusing the REQUEST ruling the write out where an
      // unread answer does not (`fl_frontend/src/shared/utils/publicSubmit.ts :: PublicAnswer`).
      appToast.danger(gesendet.wroteNothing ? ANTWORT_NICHT_GESPEICHERT : UNKLAR_TITEL, { description: gesendet.error });
      return;
    }

    const antwort = gesendet.body;

    // Wrapped again: React leaves an update after an `await` outside the transition that awaited.
    startTransition(() => {
      if (!antwort.success) {
        reportRefusedConfirmation(antwort, {
          onZustand: (zustand) => onAbschluss(spentAbschluss(zustand, antwort.beantwortet_von)),
          // The hook owns the press's one toast: none where a box shows the refusal.
          onRefusal: () =>
            reportSubmitFailure(
              {
                success: false,
                error: antwort.error ?? ANTWORT_NICHT_GESPEICHERT_SATZ,
                fieldErrors: antwort.fieldErrors,
                unplacedError: antwort.unplacedError,
              },
              { antwort: payload },
              { raise: (shown) => appToast.failure(ANTWORT_NICHT_GESPEICHERT, shown) },
            ),
        });
        return;
      }

      setSubmitFieldErrors({}, {});
      // A stored decline always carries its proposal; one answered without it reads as the Zusage it cannot be.
      if (antwort.zustand === "abgelehnt" && antwort.vorschlag !== null) {
        onAbschluss({ zustand: "abgelehnt-neu", vorschlag: antwort.vorschlag });
        return;
      }
      onAbschluss(antwort.zustand === "zugesagt" ? { zustand: "zugesagt-neu" } : { zustand: "ungueltig" });
    });
  };

  const sendeZusage = () => {
    const payload = zusagePayload(token);
    guardSubmit({ antwort: payload }, () => {
      setGedrueckt("zusage");
      startSending(async () => {
        await sende(payload);
      });
    });
  };

  // The form's own submit is the proposal's, so an Enter in one of its boxes never sends a Zusage.
  const sendeVorschlag = () => {
    const payload = vorschlagPayload(token, entwurf);
    guardSubmit({ antwort: payload }, () => {
      setGedrueckt("vorschlag");
      startSending(async () => {
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
      <BestaetigungAbschnitt titel="Deine Antwort">
        <div className="flex w-full flex-col items-stretch sm:flex-row sm:justify-end">
          <Button
            type="button"
            isPending={isPending}
            onPress={sendeZusage}
            className={formButton({ intent: "submit", stacks: true })}>
            <CircleCheck
              className="size-4.5"
              aria-hidden="true"
            />
            {isPending && gedrueckt === "zusage" ? "Sendet..." : "Zusagen"}
          </Button>
        </div>

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
              <p className={ABSATZ_CLASSES}>Mit einem Vorschlag sagst Du den Termin oben ab. Über den neuen Termin entscheidet die Liga.</p>

              <div className={FIELD_PAIR_CLASSES}>
                <AppDatePicker
                  name="vorschlag.datum"
                  label={<Label className={FIELD_LABEL_CLASSES}>Neues Datum</Label>}
                  calendarLabel="Neues Datum auswählen"
                  value={toCalendarDate(entwurf.datum)}
                  onChange={(next) => setEntwurf({ ...entwurf, datum: next?.toString() ?? "" })}
                  onBlur={() => verlassen(["vorschlag.datum"])}
                  // The calendar alone: the endpoint judges a past date, and the field marks a half-typed one otherwise.
                  minValue={parseDate(getGermanTodayStr())}
                />
                <AppTimeField
                  name="vorschlag.uhrzeit"
                  label={<Label className={FIELD_LABEL_CLASSES}>Neuer Anpfiff</Label>}
                  value={toTime(entwurf.uhrzeit)}
                  onChange={(next) => setEntwurf({ ...entwurf, uhrzeit: next?.toString() ?? "" })}
                  onBlur={() => verlassen(["vorschlag.uhrzeit"])}
                />
              </div>

              {/* One line, as the endpoint stores it: a line break is refused rather than kept. */}
              <TextField
                name="begruendung"
                value={entwurf.begruendung}
                onChange={(next) => setEntwurf({ ...entwurf, begruendung: next })}
                onBlur={() => verlassen(["begruendung"])}
                maxLength={SPIELBESTAETIGUNG_BEGRUENDUNG_MAX_LENGTH}>
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
                  isPending={isPending}
                  className={formButton({ intent: "submit", stacks: true })}>
                  {isPending && gedrueckt === "vorschlag" ? "Sendet..." : "Vorschlag senden"}
                </Button>
              </div>
            </Disclosure.Body>
          </Disclosure.Content>
        </Disclosure>
      </BestaetigungAbschnitt>
    </Form>
  );
}
